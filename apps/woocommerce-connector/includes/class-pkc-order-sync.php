<?php
/**
 * WooCommerce order sync.
 *
 * @package PersonaliseKingsConnector
 */

defined( 'ABSPATH' ) || exit;

/**
 * Sends order lifecycle events to the webapp API.
 */
class PKC_Order_Sync {
    private const ACTION_DELIVER_ORDER = 'pkc_deliver_order_event';
    private const LEGACY_ACTION_DELIVER_ORDER = 'pkc_deliver_paid_order';
    private const ACTION_PROCESS_OUTBOX = 'pkc_process_outbox_event';
    private const ACTION_SWEEP_OUTBOX = 'pkc_sweep_outbox';
    private const ACTION_RECONCILE_ORDERS = 'pkc_reconcile_modified_orders';
    private const ACTION_GROUP = 'personalise-kings-connector';
    private const CRON_OUTBOX_INTERVAL = 'pkc_every_five_minutes';
    private const CRON_RECONCILIATION_INTERVAL = 'pkc_every_fifteen_minutes';
    private const OUTBOX_SWEEP_INTERVAL = 5 * MINUTE_IN_SECONDS;
    private const RECONCILIATION_INTERVAL = 15 * MINUTE_IN_SECONDS;
    private const RECONCILIATION_OVERLAP = 5 * MINUTE_IN_SECONDS;
    private const RECONCILIATION_LOCK_TTL = 30 * MINUTE_IN_SECONDS;
    private const RECONCILIATION_BATCH_SIZE = 100;
    private const OPTION_RECONCILIATION_LOCK = 'pkc_reconciliation_lock';
    private const OPTION_LEGACY_FAILED_OFFSET = 'pkc_legacy_failed_offset_';
    private const OPTION_LEGACY_FAILED_SCAN_AT = 'pkc_legacy_failed_scan_at_';
    private const MAX_PERMANENT_ATTEMPTS = 5;
    private const RECONCILIATION_ITEM_META_KEYS = array(
        '_product_id',
        '_variation_id',
        '_qty',
        '_line_subtotal',
        '_line_total',
        '_pk_price_modifier_minor',
        '_pk_customisation_reference',
    );

    private PKC_Outbox $outbox;

    /**
     * Constructor.
     */
    public function __construct( PKC_Outbox $outbox ) {
        $this->outbox = $outbox;
        add_action( 'woocommerce_payment_complete', array( $this, 'schedule_paid_order' ) );
        add_action( 'woocommerce_order_status_changed', array( $this, 'schedule_status_change' ), 10, 4 );
        add_action( 'woocommerce_order_refunded', array( $this, 'schedule_refund' ), 10, 2 );
        add_action( 'woocommerce_refund_deleted', array( $this, 'schedule_refund_deletion' ), 10, 2 );
        add_action( 'woocommerce_update_order', array( $this, 'schedule_order_update' ) );
        add_action( 'woocommerce_new_order_item', array( $this, 'schedule_order_item_update' ), 10, 3 );
        add_action( 'woocommerce_update_order_item', array( $this, 'schedule_order_item_update' ), 10, 3 );
        add_action( 'woocommerce_before_delete_order_item', array( $this, 'schedule_order_item_deletion' ) );
        add_action( 'added_order_item_meta', array( $this, 'schedule_order_item_meta_update' ), 10, 4 );
        add_action( 'updated_order_item_meta', array( $this, 'schedule_order_item_meta_update' ), 10, 4 );
        add_action( 'deleted_order_item_meta', array( $this, 'schedule_order_item_meta_update' ), 10, 4 );
        add_action( self::ACTION_DELIVER_ORDER, array( $this, 'send_order_event' ), 10, 4 );
        add_action( self::LEGACY_ACTION_DELIVER_ORDER, array( $this, 'send_paid_order' ), 10, 2 );
        add_action( self::ACTION_PROCESS_OUTBOX, array( $this, 'process_outbox_event' ), 10, 2 );
        add_action( self::ACTION_SWEEP_OUTBOX, array( $this, 'dispatch_due_outbox' ) );
        add_action( self::ACTION_RECONCILE_ORDERS, array( $this, 'reconcile_modified_orders' ) );
        add_action( 'init', array( $this, 'ensure_reconciliation_scheduled' ), 20 );
        add_action( 'action_scheduler_init', array( $this, 'adopt_legacy_actions' ), 20 );
        add_action( 'action_scheduler_ensure_recurring_actions', array( $this, 'ensure_reconciliation_scheduled' ) );
        add_filter( 'cron_schedules', array( $this, 'register_cron_schedule' ) );
        add_filter( 'woocommerce_order_actions', array( $this, 'register_order_action' ) );
        add_action( 'woocommerce_order_action_pkc_resync_order', array( $this, 'handle_manual_resync' ) );
        add_action( 'admin_post_pkc_retry_outbox', array( $this, 'handle_outbox_retry' ) );
        add_action( 'admin_post_pkc_cancel_outbox', array( $this, 'handle_outbox_cancel' ) );
        add_action( 'admin_notices', array( $this, 'render_admin_notice' ) );
    }

    /**
     * Schedule paid order delivery outside the checkout/payment request.
     *
     * @param int $order_id WooCommerce order ID.
     */
    public function schedule_paid_order( int $order_id ): void {
        $order = wc_get_order( $order_id );
        if ( $order instanceof WC_Order ) {
            $this->schedule_delivery( $order_id, 'order.paid', $this->event_key( $order, 'order.paid' ), 1, time() );
        }
    }

    /**
     * Schedule a status-aware lifecycle event.
     *
     * @param int      $order_id Order ID.
     * @param string   $from     Previous status.
     * @param string   $to       New status.
     * @param WC_Order $order    Order object.
     */
    public function schedule_status_change( int $order_id, string $from, string $to, WC_Order $order ): void {
        unset( $from );
        $event_type = 'cancelled' === $to
            ? 'order.cancelled'
            : ( 'refunded' === $to ? 'order.refunded' : 'order.updated' );
        $this->schedule_delivery( $order_id, $event_type, $this->event_key( $order, $event_type ), 1, time() );
    }

    /**
     * Schedule partial and full refund events, even when order status does not change.
     *
     * @param int $order_id  Order ID.
     * @param int $refund_id Refund order ID.
     */
    public function schedule_refund( int $order_id, int $refund_id ): void {
        $this->schedule_delivery( $order_id, 'order.refunded', 'refund-' . $refund_id, 1, time() );
    }

    /**
     * Capture ordinary order and line-item changes that do not change status.
     *
     * @param int $order_id WooCommerce order ID.
     */
    public function schedule_order_update( int $order_id ): void {
        $order = wc_get_order( $order_id );
        if ( ! $order instanceof WC_Order ) {
            return;
        }
        $event_type = $this->event_type_for_order( $order );
        $event_key = $this->reconciliation_event_key( $order, $event_type, time() );
        $this->schedule_delivery( $order_id, $event_type, $event_key, 1, time() );
    }

    /**
     * Capture product-line changes even when the parent order timestamp is unchanged.
     *
     * @param int   $item_id  Order item ID.
     * @param mixed $item     Order item object or legacy update arguments.
     * @param int   $order_id Parent order ID when supplied by WooCommerce CRUD.
     */
    public function schedule_order_item_update( int $item_id, mixed $item = null, int $order_id = 0 ): void {
        $order_item = $item instanceof WC_Order_Item
            ? $item
            : WC_Order_Factory::get_order_item( $item_id );
        if ( $order_item instanceof WC_Order_Item_Product ) {
            $this->schedule_order_update( $order_id > 0 ? $order_id : $order_item->get_order_id() );
        }
    }

    /**
     * Capture direct updates to order-item fields included in connector payloads.
     *
     * @param mixed  $meta_id  Metadata row ID or IDs.
     * @param int    $item_id  Order item ID.
     * @param string $meta_key Metadata key.
     * @param mixed  $value    Metadata value.
     */
    public function schedule_order_item_meta_update( mixed $meta_id, int $item_id, string $meta_key, mixed $value ): void {
        unset( $meta_id, $value );
        if ( in_array( $meta_key, self::RECONCILIATION_ITEM_META_KEYS, true ) ) {
            $this->schedule_order_item_update( $item_id );
        }
    }

    /**
     * Capture a product-line deletion before WooCommerce removes its parent reference.
     *
     * @param int $item_id Order item ID.
     */
    public function schedule_order_item_deletion( int $item_id ): void {
        $item = WC_Order_Factory::get_order_item( $item_id );
        if ( $item instanceof WC_Order_Item_Product ) {
            $this->schedule_order_update( $item->get_order_id() );
        }
    }

    /**
     * Reconcile refund reversals without automatically restarting reviewed production.
     *
     * @param int $refund_id Deleted refund ID.
     * @param int $order_id  Parent order ID.
     */
    public function schedule_refund_deletion( int $refund_id, int $order_id ): void {
        unset( $refund_id );
        $order = wc_get_order( $order_id );
        if ( ! $order instanceof WC_Order ) {
            return;
        }
        $event_type = (float) $order->get_total_refunded() > 0 || in_array( $order->get_status(), array( 'cancelled', 'refunded' ), true )
            ? $this->event_type_for_order( $order )
            : 'order.updated';
        $event_key = $this->reconciliation_event_key( $order, $event_type, time() );
        $this->schedule_delivery( $order_id, $event_type, $event_key, 1, time() );
    }

    /**
     * Deliver an older paid-order action queued before connector 0.5.0.
     *
     * @param int $order_id WooCommerce order ID.
     * @param int $attempt  Delivery attempt number.
     */
    public function send_paid_order( int $order_id, int $attempt = 1 ): void {
        $order = wc_get_order( $order_id );
        $event_key = $order instanceof WC_Order
            ? $this->event_key( $order, 'order.paid' )
            : 'legacy-paid-' . $order_id . '-attempt-' . $attempt;
        $this->quarantine_legacy_delivery( $order_id, 'order.paid', $event_key, $attempt );
    }

    /**
     * Add the WP-Cron fallback interval used when Action Scheduler is unavailable.
     *
     * @param array<string, array<string, int|string>> $schedules Existing schedules.
     * @return array<string, array<string, int|string>>
     */
    public function register_cron_schedule( array $schedules ): array {
        $schedules[ self::CRON_OUTBOX_INTERVAL ] = array(
            'interval' => self::OUTBOX_SWEEP_INTERVAL,
            'display'  => __( 'Every 5 minutes', 'personalise-kings-connector' ),
        );
        $schedules[ self::CRON_RECONCILIATION_INTERVAL ] = array(
            'interval' => self::RECONCILIATION_INTERVAL,
            'display'  => __( 'Every 15 minutes', 'personalise-kings-connector' ),
        );
        return $schedules;
    }

    /**
     * Keep one recurring reconciliation action registered.
     */
    public function ensure_reconciliation_scheduled(): void {
        $this->ensure_recurring_action(
            self::ACTION_SWEEP_OUTBOX,
            self::OUTBOX_SWEEP_INTERVAL,
            self::CRON_OUTBOX_INTERVAL
        );
        $this->ensure_recurring_action(
            self::ACTION_RECONCILE_ORDERS,
            self::RECONCILIATION_INTERVAL,
            self::CRON_RECONCILIATION_INTERVAL
        );
    }

    /**
     * Keep one recurring action registered with a WP-Cron fallback.
     *
     * @param string $hook       Action hook.
     * @param int    $interval   Interval in seconds.
     * @param string $recurrence WP-Cron recurrence key.
     */
    private function ensure_recurring_action( string $hook, int $interval, string $recurrence ): void {
        if ( function_exists( 'as_has_scheduled_action' ) && function_exists( 'as_schedule_recurring_action' ) ) {
            wp_clear_scheduled_hook( $hook );
            if ( as_has_scheduled_action( $hook, array(), self::ACTION_GROUP ) ) {
                return;
            }
            $action_id = as_schedule_recurring_action(
                time() + MINUTE_IN_SECONDS,
                $interval,
                $hook,
                array(),
                self::ACTION_GROUP,
                true
            );
            if ( 0 !== $action_id ) {
                PKC_Observability::record( 'scheduler', 'action_scheduler' );
                return;
            }
        }

        if ( ! wp_next_scheduled( $hook ) ) {
            $scheduled = wp_schedule_event(
                time() + MINUTE_IN_SECONDS,
                $recurrence,
                $hook
            );
            PKC_Observability::record( 'scheduler', false === $scheduled ? 'failure' : 'wp_cron' );
        }
    }

    /**
     * Queue lifecycle snapshots for orders modified since the durable watermark.
     */
    public function reconcile_modified_orders(): void {
        $this->dispatch_due_outbox();
        $this->outbox->maybe_cleanup();
        if ( ! $this->connector_is_configured() ) {
            PKC_Observability::record( 'reconciliation', 'configuration_skipped' );
            return;
        }
        $lock_token = $this->acquire_reconciliation_lock();
        if ( null === $lock_token ) {
            PKC_Observability::record( 'reconciliation', 'lock_skipped' );
            return;
        }

        $scan_started_at = time();
        $watermark = (int) get_option(
            PKC_Settings::OPTION_RECONCILIATION_WATERMARK,
            $scan_started_at - self::RECONCILIATION_INTERVAL
        );
        $query_after = max( 0, $watermark - self::RECONCILIATION_OVERLAP );
        $reconciled = 0;

        try {
            $order_ids = wc_get_orders(
                array(
                    'type'          => 'shop_order',
                    'date_modified' => $query_after . '...' . $scan_started_at,
                    'orderby'       => 'modified',
                    'order'         => 'ASC',
                    'limit'         => -1,
                    'return'        => 'ids',
                )
            );
            if ( ! is_array( $order_ids ) ) {
                throw new UnexpectedValueException( 'WooCommerce returned an invalid reconciliation result.' );
            }

            foreach ( array_chunk( $order_ids, self::RECONCILIATION_BATCH_SIZE ) as $order_id_batch ) {
                foreach ( $order_id_batch as $order_id ) {
                    $order = wc_get_order( (int) $order_id );
                    if ( ! $order instanceof WC_Order ) {
                        continue;
                    }
                    $event_type = $this->event_type_for_order( $order );
                    $event_key = $this->reconciliation_event_key( $order, $event_type );
                    if ( ! $this->schedule_delivery( $order->get_id(), $event_type, $event_key, 1, time() ) ) {
                        throw new RuntimeException( 'An order reconciliation event could not be queued.' );
                    }
                    ++$reconciled;
                }
            }

            update_option( PKC_Settings::OPTION_RECONCILIATION_WATERMARK, $scan_started_at, false );
            update_option( PKC_Settings::OPTION_LAST_RECONCILIATION, gmdate( 'c', $scan_started_at ), false );
            update_option( PKC_Settings::OPTION_LAST_RECONCILIATION_COUNT, $reconciled, false );
            delete_option( PKC_Settings::OPTION_RECONCILIATION_ERROR );
            PKC_Observability::record( 'reconciliation', 'success' );
        } catch ( Throwable $error ) {
            update_option(
                PKC_Settings::OPTION_RECONCILIATION_ERROR,
                wp_strip_all_tags( $error->getMessage() ),
                false
            );
            PKC_Observability::record( 'reconciliation', 'failure' );
        } finally {
            $this->release_reconciliation_lock( $lock_token );
        }
    }

    /**
     * Send one status-aware order event.
     *
     * @param int    $order_id  WooCommerce order ID.
     * @param string $event_type Platform-neutral event type.
     * @param string $event_key Stable lifecycle occurrence key.
     * @param int    $attempt   Delivery attempt number.
     */
    public function send_order_event( int $order_id, string $event_type, string $event_key, int $attempt = 1 ): void {
        $this->quarantine_legacy_delivery( $order_id, $event_type, $event_key, $attempt );
    }

    /**
     * Preserve a pre-0.7 action without guessing its original store binding.
     *
     * @param int    $order_id  WooCommerce order ID.
     * @param string $event_type Event type.
     * @param string $event_key Event key.
     * @param int    $attempt   Legacy attempt number.
     * @param int    $legacy_action_id Action Scheduler ID when known.
     * @param string $legacy_hook Scheduler hook when known.
     */
    private function quarantine_legacy_delivery( int $order_id, string $event_type, string $event_key, int $attempt, int $legacy_action_id = 0, string $legacy_hook = '' ): bool {
        $order = wc_get_order( $order_id );
        $occurred_at = $order instanceof WC_Order
            ? $this->event_timestamp( $order, $event_key )
            : gmdate( 'c', $this->event_key_timestamp( $event_key ) ?? time() );
        $row = $this->outbox->enqueue_failed(
            $order_id,
            $event_type,
            $event_key,
            $occurred_at,
            home_url(),
            $attempt,
            'Legacy scheduler action has no immutable store binding; create a fresh manual resync.',
            $legacy_action_id,
            $legacy_hook
        );
        return is_array( $row ) && PKC_Outbox::STATUS_FAILED === (string) $row['status'];
    }

    /**
     * Process one atomically claimed outbox row.
     *
     * @param int $outbox_id  Outbox row ID.
     * @param int $generation Scheduler generation.
     */
    public function process_outbox_event( int $outbox_id, int $generation = 1 ): void {
        $row = $this->outbox->claim( $outbox_id, $generation );
        if ( ! is_array( $row ) ) {
            return;
        }
        $claim_token = (string) $row['claim_token'];
        $order_id = (int) $row['order_id'];
        $event_type = (string) $row['event_type'];
        $event_key = (string) $row['event_key'];
        $order = wc_get_order( $order_id );
        if ( ! $order instanceof WC_Order ) {
            $this->outbox->mark_failed( $outbox_id, $claim_token, 'WooCommerce order no longer exists.' );
            $this->record_failure( $order_id, 'WooCommerce order no longer exists.' );
            return;
        }
        if ( ! in_array( $event_type, array( 'order.paid', 'order.updated', 'order.cancelled', 'order.refunded' ), true ) ) {
            $this->outbox->mark_failed( $outbox_id, $claim_token, 'Connector event type is invalid.' );
            $this->record_failure( $order_id, 'Connector event type is invalid.' );
            return;
        }
        $bound_store_id = (string) $row['store_id'];
        $current_store_id = (string) get_option( PKC_Settings::OPTION_STORE_ID, '' );
        if ( '' === $bound_store_id ) {
            $this->outbox->mark_failed( $outbox_id, $claim_token, 'Queued event has no immutable store binding; create a fresh manual resync.' );
            $this->record_failure( $order_id, 'Queued event has no immutable store binding; create a fresh manual resync.' );
            return;
        }
        if ( '' === $current_store_id ) {
            $this->retry_outbox( $row, $claim_token, 'Connector store configuration is incomplete.', null, true );
            return;
        }
        if ( ! hash_equals( $bound_store_id, $current_store_id ) ) {
            $this->outbox->mark_failed( $outbox_id, $claim_token, 'Queued event belongs to a different store configuration.' );
            $this->record_failure( $order_id, 'Queued event belongs to a different store configuration.' );
            return;
        }

        if ( ! $this->event_matches_order( $event_type, $order ) ) {
            $current_event_type = $this->event_type_for_order( $order );
            $current_event_key = $this->reconciliation_event_key( $order, $current_event_type, time() );
            if ( $this->schedule_delivery( $order_id, $current_event_type, $current_event_key, 1, time(), $bound_store_id ) ) {
                $this->outbox->mark_superseded( $outbox_id, $claim_token, 'Order state changed before delivery.' );
            } else {
                $this->retry_outbox( $row, $claim_token, 'Current order state could not be persisted.', null, true );
            }
            return;
        }
        if ( str_starts_with( $event_key, 'reconcile-' ) ) {
            $current_event_key = $this->reconciliation_event_key(
                $order,
                $event_type,
                $this->event_key_timestamp( $event_key ) ?? time()
            );
            if ( ! hash_equals( $event_key, $current_event_key ) ) {
                $latest_event_key = $this->reconciliation_event_key( $order, $event_type, time() );
                if ( $this->schedule_delivery( $order_id, $event_type, $latest_event_key, 1, time(), $bound_store_id ) ) {
                    $this->outbox->mark_superseded( $outbox_id, $claim_token, 'A newer order snapshot replaced this event.' );
                } else {
                    $this->retry_outbox( $row, $claim_token, 'Latest order snapshot could not be persisted.', null, true );
                }
                return;
            }
        }

        $api_url = rtrim( (string) get_option( PKC_Settings::OPTION_API_URL, '' ), '/' );
        $store_id = $current_store_id;
        $credential = PKC_Settings::signing_credential();
        if ( ! PKC_Settings::is_valid_endpoint_url( $api_url ) || '' === $store_id || ! $credential ) {
            $this->retry_outbox( $row, $claim_token, 'Connector credentials are incomplete.', null, true );
            return;
        }
        $key_id = $credential['key_id'];
        $secret = $credential['secret'];

        if ( empty( $row['payload_json'] ) ) {
            $payload = $this->build_payload( $order, $event_type, $event_key );
            $payload_json = wp_json_encode( $payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE );
            if ( ! is_string( $payload_json ) ) {
                $this->outbox->mark_failed( $outbox_id, $claim_token, 'Connector payload could not be encoded.' );
                $this->record_failure( $order_id, 'Connector payload could not be encoded.' );
                return;
            }
            $event_identity = $store_id . '|' . $order_id . '|' . $event_type . '|' . $event_key;
            $materialized = $this->outbox->materialize(
                $outbox_id,
                $claim_token,
                $store_id,
                'woo-' . hash( 'sha256', $event_identity ),
                substr( hash_hmac( 'sha256', 'nonce|' . $event_identity, $secret ), 0, 32 ),
                (string) $payload['idempotency_key'],
                $payload_json
            );
            if ( ! $materialized ) {
                $this->retry_outbox( $row, $claim_token, 'Connector payload could not be frozen.', null, true );
                return;
            }
            $row = $this->outbox->get( $outbox_id );
        }
        if ( ! is_array( $row ) || ! hash_equals( $claim_token, (string) ( $row['claim_token'] ?? '' ) ) ) {
            return;
        }
        if ( empty( $row['event_id'] ) || empty( $row['nonce'] ) || empty( $row['payload_json'] ) || empty( $row['connector_instance_id'] ) ) {
            $this->outbox->mark_failed( $outbox_id, $claim_token, 'Materialized outbox data is incomplete.' );
            $this->record_failure( $order_id, 'Materialized outbox data is incomplete.' );
            return;
        }

        $payload = json_decode( (string) $row['payload_json'], true );
        if ( ! is_array( $payload ) ) {
            $this->outbox->mark_failed( $outbox_id, $claim_token, 'Stored connector payload is invalid.' );
            $this->record_failure( $order_id, 'Stored connector payload is invalid.' );
            return;
        }
        $payload_json = $this->canonical_json( $payload );
        $occurred_timestamp = strtotime( (string) $row['occurred_at_gmt'] . ' UTC' );
        $event = array(
            'event_id'              => (string) $row['event_id'],
            'event_type'            => $event_type,
            'event_version'         => '2026-07-14',
            'store_id'              => (string) $row['store_id'],
            'connector_instance_id' => (string) $row['connector_instance_id'],
            'occurred_at'           => gmdate( 'c', false === $occurred_timestamp ? time() : $occurred_timestamp ),
            'sent_at'               => gmdate( 'c' ),
            'key_id'                => $key_id,
            'nonce'                 => (string) $row['nonce'],
            'content_digest'        => 'sha256=' . base64_encode( hash( 'sha256', $payload_json, true ) ),
            'payload'               => $payload,
        );
        $body = wp_json_encode( $event );
        if ( ! is_string( $body ) ) {
            $this->outbox->mark_failed( $outbox_id, $claim_token, 'Connector event could not be encoded.' );
            $this->record_failure( $order_id, 'Connector event could not be encoded.' );
            return;
        }
        if ( ! $this->outbox->renew_claim( $outbox_id, $claim_token ) ) {
            return;
        }

        $response = wp_safe_remote_post(
            $api_url . '/v1/connector/events',
            array(
                'timeout' => 10,
                'redirection' => 0,
                'limit_response_size' => 4096,
                'headers' => array(
                    'Content-Type'   => 'application/json',
                    'X-PK-Signature' => 'sha256=' . hash_hmac( 'sha256', $body, $secret ),
                ),
                'body'    => $body,
            )
        );
        if ( is_wp_error( $response ) ) {
            $this->retry_outbox( $row, $claim_token, $response->get_error_message(), null, true );
            return;
        }

        $status_code = (int) wp_remote_retrieve_response_code( $response );
        if ( $status_code < 200 || $status_code >= 300 ) {
            $message = 'HTTP ' . $status_code . ': ' . $this->bounded_error( (string) wp_remote_retrieve_body( $response ) );
            $this->retry_outbox( $row, $claim_token, $message, $status_code, $this->is_transient_status( $status_code ) );
            return;
        }

        if ( $this->outbox->mark_delivered( $outbox_id, $claim_token, $status_code ) ) {
            update_option( PKC_Settings::OPTION_LAST_SUCCESS, gmdate( 'c' ), false );
            delete_option( PKC_Settings::OPTION_LAST_ERROR );
        }
    }

    /**
     * Persist a failed claim for retry or terminal review.
     *
     * @param array<string, mixed> $row          Claimed outbox row.
     * @param string               $claim_token  Claim owner token.
     * @param string               $message      Failure message.
     * @param int|null             $http_status  HTTP response status.
     * @param bool                 $is_transient Whether retries remain indefinite.
     */
    private function retry_outbox( array $row, string $claim_token, string $message, ?int $http_status, bool $is_transient ): void {
        $order_id = (int) $row['order_id'];
        $attempt = (int) $row['attempt_count'];
        $this->record_failure( $order_id, $message );
        if ( ! $is_transient && $attempt >= self::MAX_PERMANENT_ATTEMPTS ) {
            $this->outbox->mark_failed( (int) $row['id'], $claim_token, $message, $http_status );
            return;
        }
        $delay = min( 15 * MINUTE_IN_SECONDS, ( 2 ** min( $attempt, 4 ) ) * MINUTE_IN_SECONDS );
        $retry = $this->outbox->mark_retry(
            (int) $row['id'],
            $claim_token,
            time() + $delay,
            $message,
            $http_status
        );
        if ( is_array( $retry ) ) {
            $this->schedule_outbox_wakeup( $retry, time() + $delay );
        }
    }

    /**
     * Persist one logical delivery before creating a scheduler wake-up.
     *
     * @param int    $order_id  WooCommerce order ID.
     * @param string $event_type Event type.
     * @param string $event_key Stable event key.
     * @param int    $attempt   Attempt number.
     * @param int    $timestamp Unix timestamp.
     * @param string|null $store_id_override Validated store binding for a replacement event.
     * @return bool Whether the event is present in the local queue.
     */
    private function schedule_delivery( int $order_id, string $event_type, string $event_key, int $attempt, int $timestamp, ?string $store_id_override = null ): bool {
        $order = wc_get_order( $order_id );
        $store_id = $store_id_override ?? (string) get_option( PKC_Settings::OPTION_STORE_ID, '' );
        $event_timestamp = $order instanceof WC_Order
            ? $this->event_timestamp( $order, $event_key )
            : gmdate( 'c', $this->event_key_timestamp( $event_key ) ?? time() );
        if ( '' === $store_id ) {
            $row = $this->outbox->enqueue_failed(
                $order_id,
                $event_type,
                $event_key,
                $event_timestamp,
                home_url(),
                $attempt,
                'Event was queued before a PersonaliseKings store was connected; create a fresh manual resync.'
            );
            if ( is_array( $row ) ) {
                $this->record_failure( $order_id, 'Event was stored without a store binding and requires a fresh manual resync.' );
                return true;
            }
            return false;
        }
        $row = $this->outbox->enqueue(
            $order_id,
            $event_type,
            $event_key,
            $event_timestamp,
            $store_id,
            home_url(),
            $attempt,
            $timestamp
        );
        if ( ! is_array( $row ) ) {
            return false;
        }
        if ( in_array( (string) $row['status'], array( PKC_Outbox::STATUS_PENDING, PKC_Outbox::STATUS_RETRY_WAIT ), true ) ) {
            $available_at = strtotime( (string) $row['next_attempt_gmt'] . ' UTC' );
            if ( ! $this->schedule_outbox_wakeup( $row, false === $available_at ? $timestamp : $available_at ) ) {
                $this->record_failure( $order_id, 'Outbox event is persisted but its scheduler wake-up is pending repair.' );
            }
        }
        return true;
    }

    /**
     * Create a disposable scheduler wake-up for a durable row.
     *
     * @param array<string, mixed> $row       Outbox row.
     * @param int                  $timestamp Unix timestamp.
     */
    private function schedule_outbox_wakeup( array $row, int $timestamp ): bool {
        $arguments = array( (int) $row['id'], (int) $row['generation'] );
        if ( function_exists( 'as_schedule_single_action' ) ) {
            if ( function_exists( 'as_has_scheduled_action' ) && as_has_scheduled_action( self::ACTION_PROCESS_OUTBOX, $arguments, self::ACTION_GROUP ) ) {
                return true;
            }
            $action_id = as_schedule_single_action( $timestamp, self::ACTION_PROCESS_OUTBOX, $arguments, self::ACTION_GROUP, true );
            if ( 0 !== $action_id ) {
                $this->outbox->set_scheduled_action( (int) $row['id'], (int) $row['generation'], (int) $action_id );
                PKC_Observability::record( 'scheduler', 'action_scheduler' );
                return true;
            }
        }

        if ( wp_next_scheduled( self::ACTION_PROCESS_OUTBOX, $arguments ) ) {
            return true;
        }
        $scheduled = false !== wp_schedule_single_event( $timestamp, self::ACTION_PROCESS_OUTBOX, $arguments );
        if ( $scheduled ) {
            $this->outbox->set_scheduled_action( (int) $row['id'], (int) $row['generation'], 0 );
            PKC_Observability::record( 'scheduler', 'wp_cron' );
        } else {
            PKC_Observability::record( 'scheduler', 'failure' );
        }
        return $scheduled;
    }

    /**
     * Repair missing wake-ups and recover stale claims in bounded batches.
     */
    public function dispatch_due_outbox(): void {
        $succeeded = true;
        foreach ( $this->outbox->due( 100 ) as $row ) {
            if ( ! $this->schedule_outbox_wakeup( $row, time() ) ) {
                $succeeded = false;
            }
        }
        $this->outbox->maybe_cleanup();
        PKC_Observability::record( 'sweep', $succeeded ? 'success' : 'failure' );
    }

    /**
     * Adopt pending Action Scheduler work created by connector 0.5 and 0.6.
     */
    public function adopt_legacy_actions(): void {
        if ( ! $this->outbox->is_available() || ! function_exists( 'as_get_scheduled_actions' ) || ! function_exists( 'as_unschedule_action' ) ) {
            return;
        }

        foreach ( array( self::ACTION_DELIVER_ORDER, self::LEGACY_ACTION_DELIVER_ORDER ) as $hook ) {
            foreach ( array( 'pending', 'failed' ) as $legacy_status ) {
                $offset_option = self::OPTION_LEGACY_FAILED_OFFSET . md5( $hook );
                $scan_option = self::OPTION_LEGACY_FAILED_SCAN_AT . md5( $hook );
                if ( 'failed' === $legacy_status && (int) get_option( $scan_option, 0 ) > time() - DAY_IN_SECONDS ) {
                    continue;
                }
                $offset = 'failed' === $legacy_status ? max( 0, (int) get_option( $offset_option, 0 ) ) : 0;
                $actions = as_get_scheduled_actions(
                    array(
                        'hook'     => $hook,
                        'group'    => self::ACTION_GROUP,
                        'status'   => $legacy_status,
                        'per_page' => 50,
                        'offset'   => $offset,
                        'orderby'  => 'date',
                        'order'    => 'ASC',
                    )
                );
                foreach ( is_array( $actions ) ? $actions : array() as $action_id => $action ) {
                    if ( $this->outbox->has_legacy_action( (int) $action_id ) ) {
                        continue;
                    }
                    if ( ! is_object( $action ) || ! method_exists( $action, 'get_args' ) ) {
                        continue;
                    }
                    $arguments = $action->get_args();
                    $order_id = isset( $arguments[0] ) ? (int) $arguments[0] : 0;
                    $event_type = self::ACTION_DELIVER_ORDER === $hook && isset( $arguments[1] ) ? (string) $arguments[1] : 'order.paid';
                    $event_key = self::ACTION_DELIVER_ORDER === $hook && isset( $arguments[2] ) ? (string) $arguments[2] : '';
                    $attempt = self::ACTION_DELIVER_ORDER === $hook && isset( $arguments[3] )
                        ? (int) $arguments[3]
                        : ( isset( $arguments[1] ) ? (int) $arguments[1] : 1 );
                    $order = wc_get_order( $order_id );
                    if ( '' === $event_key && $order instanceof WC_Order ) {
                        $event_key = $this->event_key( $order, $event_type );
                    }
                    if ( '' === $event_key ) {
                        $event_key = 'legacy-action-' . (int) $action_id;
                    }

                    $queued = $this->quarantine_legacy_delivery( $order_id, $event_type, $event_key, $attempt, (int) $action_id, $hook );

                    if ( $queued && 'pending' === $legacy_status ) {
                        as_unschedule_action( $hook, $arguments, self::ACTION_GROUP );
                    }
                }
                if ( 'failed' === $legacy_status ) {
                    $action_count = count( $actions );
                    update_option( $offset_option, $action_count < 50 ? 0 : $offset + $action_count, false );
                    if ( $action_count < 50 ) {
                        update_option( $scan_option, time(), false );
                    }
                }
            }
        }
        $this->dispatch_due_outbox();
    }

    /**
     * Retry or accelerate an outbox row from Connector Health.
     */
    public function handle_outbox_retry(): void {
        if ( ! current_user_can( 'manage_woocommerce' ) ) {
            wp_die( esc_html__( 'You do not have permission to manage this queue.', 'personalise-kings-connector' ) );
        }
        $outbox_id = isset( $_POST['outbox_id'] ) ? absint( wp_unslash( $_POST['outbox_id'] ) ) : 0;
        check_admin_referer( 'pkc_outbox_' . $outbox_id );
        $row = $this->outbox->retry_now( $outbox_id, get_current_user_id() );
        $notice = 'retry_failed';
        if ( is_array( $row ) ) {
            $notice = $this->schedule_outbox_wakeup( $row, time() ) ? 'retried' : 'retry_persisted';
        }
        $this->redirect_outbox_notice( $notice );
    }

    /**
     * Cancel an unclaimed outbox row from Connector Health.
     */
    public function handle_outbox_cancel(): void {
        if ( ! current_user_can( 'manage_woocommerce' ) ) {
            wp_die( esc_html__( 'You do not have permission to manage this queue.', 'personalise-kings-connector' ) );
        }
        $outbox_id = isset( $_POST['outbox_id'] ) ? absint( wp_unslash( $_POST['outbox_id'] ) ) : 0;
        check_admin_referer( 'pkc_outbox_' . $outbox_id );
        $previous = $this->outbox->cancel( $outbox_id, get_current_user_id() );
        if ( is_array( $previous ) ) {
            $arguments = array( $outbox_id, (int) $previous['generation'] );
            if ( function_exists( 'as_unschedule_action' ) ) {
                as_unschedule_action( self::ACTION_PROCESS_OUTBOX, $arguments, self::ACTION_GROUP );
            }
            wp_clear_scheduled_hook( self::ACTION_PROCESS_OUTBOX, $arguments );
        }
        $this->redirect_outbox_notice( is_array( $previous ) ? 'cancelled' : 'cancel_failed' );
    }

    /**
     * Return to the connector page after one queue action.
     *
     * @param string $notice Result code.
     */
    private function redirect_outbox_notice( string $notice ): never {
        wp_safe_redirect(
            add_query_arg(
                array(
                    'page'              => 'personalise-kings-connector',
                    'pkc_outbox_notice' => $notice,
                ),
                admin_url( 'admin.php' )
            )
        );
        exit;
    }

    /**
     * Record delivery failure health state.
     *
     * @param int    $order_id WooCommerce order ID.
     * @param string $message  Error message.
     */
    private function record_failure( int $order_id, string $message ): void {
        update_option( PKC_Settings::OPTION_LAST_FAILURE, gmdate( 'c' ), false );
        update_option( PKC_Settings::OPTION_LAST_ERROR, 'Order ' . $order_id . ': ' . $this->bounded_error( $message ), false );
    }

    /**
     * Bound persisted remote errors and strip markup.
     *
     * @param string $error Error text.
     */
    private function bounded_error( string $error ): string {
        $error = wp_strip_all_tags( $error );
        return function_exists( 'mb_substr' ) ? mb_substr( $error, 0, 2000 ) : substr( $error, 0, 2000 );
    }

    /**
     * Decide whether an HTTP response should remain in the retry queue indefinitely.
     *
     * @param int $status_code HTTP status code.
     */
    private function is_transient_status( int $status_code ): bool {
        return in_array( $status_code, array( 408, 425, 429 ), true ) || $status_code >= 500;
    }

    /**
     * Add manual resync order action.
     *
     * @param array<string, string> $actions Existing order actions.
     * @return array<string, string>
     */
    public function register_order_action( array $actions ): array {
        $actions['pkc_resync_order'] = __( 'Resync to PersonaliseKings', 'personalise-kings-connector' );
        return $actions;
    }

    /**
     * Handle manual resync action.
     *
     * @param WC_Order $order WooCommerce order.
     */
    public function handle_manual_resync( WC_Order $order ): void {
        $event_type = $this->event_type_for_order( $order );
        $event_key = 'manual-at-' . time() . '-' . wp_generate_uuid4();
        $queued = $this->schedule_delivery( $order->get_id(), $event_type, $event_key, 1, time() );
        set_transient(
            'pkc_admin_notice',
            $queued
                ? __( 'PersonaliseKings resync has been queued.', 'personalise-kings-connector' )
                : __( 'PersonaliseKings resync could not be queued.', 'personalise-kings-connector' ),
            30
        );
        set_transient( 'pkc_admin_notice_type', $queued ? 'success' : 'error', 30 );
    }

    /**
     * Render queued action notice.
     */
    public function render_admin_notice(): void {
        $message = get_transient( 'pkc_admin_notice' );
        if ( ! $message ) {
            return;
        }

        $notice_type = 'error' === get_transient( 'pkc_admin_notice_type' ) ? 'error' : 'success';
        delete_transient( 'pkc_admin_notice' );
        delete_transient( 'pkc_admin_notice_type' );
        echo '<div class="notice notice-' . esc_attr( $notice_type ) . ' is-dismissible"><p>' . esc_html( (string) $message ) . '</p></div>';
    }

    /**
     * Build platform-neutral order payload.
     *
     * @param WC_Order $order      WooCommerce order.
     * @param string   $event_type Platform-neutral event type.
     * @param string   $event_key  Stable lifecycle occurrence key.
     * @return array<string, mixed>
     */
    private function build_payload( WC_Order $order, string $event_type, string $event_key ): array {
        return array(
            'store_type'            => 'woocommerce',
            'external_order_id'     => (string) $order->get_id(),
            'external_order_number' => $order->get_order_number(),
            'currency'              => $order->get_currency(),
            'order_status'          => $order->get_status(),
            'metadata'              => array(
                'event_type'     => $event_type,
                'event_key'      => $event_key,
                'total_refunded' => (string) $order->get_total_refunded(),
                ...$this->refund_metadata( $event_key ),
            ),
            'line_items'            => $this->build_line_items( $order ),
            'idempotency_key'       => 'woo-order-' . $order->get_id() . '-' . str_replace( '.', '-', $event_type ) . '-' . $event_key,
            'event_timestamp'       => $this->event_timestamp( $order, $event_key ),
        );
    }

    /**
     * Build the order lines shared by event payloads and reconciliation fingerprints.
     *
     * @param WC_Order $order WooCommerce order.
     * @return array<int, array<string, mixed>>
     */
    private function build_line_items( WC_Order $order ): array {
        $line_items = array();
        foreach ( $order->get_items() as $item_id => $item ) {
            if ( ! $item instanceof WC_Order_Item_Product ) {
                continue;
            }

            $line_item = array(
                'external_line_item_id' => (string) $item_id,
                'external_product_id'   => (string) $item->get_product_id(),
                'quantity'              => (int) $item->get_quantity(),
                'metadata'              => array(
                    'price_modifier_minor' => (int) $item->get_meta( '_pk_price_modifier_minor', true ),
                    'line_subtotal'        => (string) $item->get_subtotal(),
                    'line_total'           => (string) $item->get_total(),
                ),
            );
            if ( $item->get_variation_id() > 0 ) {
                $line_item['external_variant_id'] = (string) $item->get_variation_id();
            }
            $customisation_reference = (string) $item->get_meta( '_pk_customisation_reference', true );
            if ( '' !== $customisation_reference ) {
                $line_item['customisation_reference'] = $customisation_reference;
            }
            $line_items[] = $line_item;
        }
        return $line_items;
    }

    /**
     * Choose the event used by manual reconciliation.
     *
     * @param WC_Order $order WooCommerce order.
     */
    private function event_type_for_order( WC_Order $order ): string {
        if ( 'cancelled' === $order->get_status() ) {
            return 'order.cancelled';
        }
        if ( 'refunded' === $order->get_status() || (float) $order->get_total_refunded() > 0 ) {
            return 'order.refunded';
        }
        return $order->is_paid() ? 'order.paid' : 'order.updated';
    }

    /**
     * Confirm a queued occurrence still represents the current order state.
     *
     * @param string   $event_type Queued event type.
     * @param WC_Order $order      Current order.
     */
    private function event_matches_order( string $event_type, WC_Order $order ): bool {
        $status = $order->get_status();
        $has_refund = (float) $order->get_total_refunded() > 0;
        return match ( $event_type ) {
            'order.paid'      => $order->is_paid() && ! $has_refund,
            'order.cancelled' => 'cancelled' === $status,
            'order.refunded'  => 'cancelled' !== $status && ( 'refunded' === $status || $has_refund ),
            'order.updated'   => ! in_array( $status, array( 'cancelled', 'refunded' ), true ) && ! $has_refund,
            default           => false,
        };
    }

    /**
     * Build a retry-stable key that changes whenever the reconciled order changes.
     *
     * @param WC_Order $order      WooCommerce order.
     * @param string   $event_type Event type.
     */
    private function reconciliation_event_key( WC_Order $order, string $event_type, ?int $occurred_at = null ): string {
        $date = $order->get_date_modified() ?: $order->get_date_created();
        $timestamp = $occurred_at ?? ( $date ? $date->getTimestamp() : time() );
        $fingerprint = substr(
            hash(
                'sha256',
                $this->canonical_json(
                    array(
                        'currency'              => $order->get_currency(),
                        'external_order_number' => $order->get_order_number(),
                        'line_items'            => $this->build_line_items( $order ),
                        'order_status'          => $order->get_status(),
                        'total_refunded'        => (string) $order->get_total_refunded(),
                    )
                )
            ),
            0,
            16
        );
        return 'reconcile-' . str_replace( '.', '-', $event_type ) . '-' . $order->get_status() . '-at-' . $timestamp . '-' . $fingerprint;
    }

    /**
     * Build a stable key for one lifecycle occurrence.
     *
     * @param WC_Order $order      WooCommerce order.
     * @param string   $event_type Event type.
     */
    private function event_key( WC_Order $order, string $event_type ): string {
        $date = $order->get_date_modified() ?: $order->get_date_created();
        $timestamp = $date ? $date->getTimestamp() : time();
        return str_replace( '.', '-', $event_type ) . '-' . $order->get_status() . '-at-' . $timestamp;
    }

    /**
     * Return a stable event timestamp, preferring a refund's own creation date.
     *
     * @param WC_Order $order     WooCommerce order.
     * @param string   $event_key Event key.
     */
    private function event_timestamp( WC_Order $order, string $event_key ): string {
        if ( preg_match( '/^refund-(\d+)$/', $event_key, $matches ) ) {
            $refund = wc_get_order( (int) $matches[1] );
            if ( $refund instanceof WC_Order_Refund && $refund->get_date_created() ) {
                return gmdate( 'c', $refund->get_date_created()->getTimestamp() );
            }
        } else {
            $timestamp = $this->event_key_timestamp( $event_key );
            if ( null !== $timestamp ) {
                return gmdate( 'c', $timestamp );
            }
        }
        $date = $order->get_date_modified() ?: $order->get_date_created();
        return $date ? gmdate( 'c', $date->getTimestamp() ) : gmdate( 'c' );
    }

    /**
     * Read the occurrence timestamp from current and legacy event keys.
     *
     * @param string $event_key Event key.
     */
    private function event_key_timestamp( string $event_key ): ?int {
        if ( preg_match( '/-at-(\d{10,})(?:-|$)/', $event_key, $matches ) ) {
            return (int) $matches[1];
        }
        if ( preg_match( '/^(?:reconcile-)?order-(?:paid|updated|cancelled|refunded)-.+-(\d{10,})$/', $event_key, $matches ) ) {
            return (int) $matches[1];
        }
        return null;
    }

    /**
     * Add refund-specific data without changing the platform-neutral envelope.
     *
     * @param string $event_key Event key.
     * @return array<string, mixed>
     */
    private function refund_metadata( string $event_key ): array {
        if ( ! preg_match( '/^refund-(\d+)$/', $event_key, $matches ) ) {
            return array();
        }
        $refund = wc_get_order( (int) $matches[1] );
        if ( ! $refund instanceof WC_Order_Refund ) {
            return array();
        }
        return array(
            'refund_id'     => (string) $refund->get_id(),
            'refund_amount' => (string) $refund->get_amount(),
            'refund_reason' => $refund->get_reason(),
        );
    }

    /**
     * Check whether reconciliation can safely queue signed events.
     */
    private function connector_is_configured(): bool {
        return '' !== (string) get_option( PKC_Settings::OPTION_API_URL, '' )
            && '' !== (string) get_option( PKC_Settings::OPTION_STORE_ID, '' )
            && null !== PKC_Settings::signing_credential();
    }

    /**
     * Acquire an option-backed lock, recovering it after an interrupted scan.
     */
    private function acquire_reconciliation_lock(): ?string {
        $now = time();
        $token = wp_generate_uuid4();
        $lock = array( 'token' => $token, 'locked_at' => $now );
        if ( add_option( self::OPTION_RECONCILIATION_LOCK, $lock, '', false ) ) {
            return $token;
        }

        $existing_lock = get_option( self::OPTION_RECONCILIATION_LOCK, 0 );
        $locked_at = is_array( $existing_lock ) && isset( $existing_lock['locked_at'] )
            ? (int) $existing_lock['locked_at']
            : (int) $existing_lock;
        if ( $locked_at > $now - self::RECONCILIATION_LOCK_TTL ) {
            return null;
        }

        global $wpdb;
        $updated = $wpdb->update(
            $wpdb->options,
            array( 'option_value' => maybe_serialize( $lock ) ),
            array(
                'option_name'  => self::OPTION_RECONCILIATION_LOCK,
                'option_value' => maybe_serialize( $existing_lock ),
            ),
            array( '%s' ),
            array( '%s', '%s' )
        );
        wp_cache_delete( self::OPTION_RECONCILIATION_LOCK, 'options' );
        return 1 === $updated ? $token : null;
    }

    /**
     * Release only the lock owned by this scan.
     *
     * @param string $token Lock owner token.
     */
    private function release_reconciliation_lock( string $token ): void {
        $lock = get_option( self::OPTION_RECONCILIATION_LOCK, array() );
        if ( ! is_array( $lock ) || ! isset( $lock['token'] ) || ! hash_equals( $token, (string) $lock['token'] ) ) {
            return;
        }
        global $wpdb;
        $wpdb->delete(
            $wpdb->options,
            array(
                'option_name'  => self::OPTION_RECONCILIATION_LOCK,
                'option_value' => maybe_serialize( $lock ),
            ),
            array( '%s', '%s' )
        );
        wp_cache_delete( self::OPTION_RECONCILIATION_LOCK, 'options' );
    }

    /**
     * Produce canonical JSON matching the webapp digest implementation.
     *
     * @param mixed $value Value to encode.
     */
    private function canonical_json( mixed $value ): string {
        return (string) wp_json_encode(
            $this->sort_for_json( $value ),
            JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE
        );
    }

    /**
     * Sort object keys recursively.
     *
     * @param mixed $value Value to sort.
     * @return mixed
     */
    private function sort_for_json( mixed $value ): mixed {
        if ( is_array( $value ) ) {
            if ( array_is_list( $value ) ) {
                return array_map( array( $this, 'sort_for_json' ), $value );
            }

            ksort( $value );
            foreach ( $value as $key => $entry ) {
                $value[ $key ] = $this->sort_for_json( $entry );
            }
        }

        return $value;
    }
}
