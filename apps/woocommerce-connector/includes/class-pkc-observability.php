<?php
/**
 * Privacy-bounded local connector observability.
 *
 * @package PersonaliseKingsConnector
 */

defined( 'ABSPATH' ) || exit;

/**
 * Stores bounded local counters and exposes WordPress Site Health diagnostics.
 */
class PKC_Observability {
    public const OPTION_STATE = 'pkc_observability_v1';
    private const STATE_VERSION = 1;
    private const RETENTION_DAYS = 14;
    private const MAX_STATE_BYTES = 32768;
    private const METRICS = array(
        'cleanup'        => array( 'success', 'failure' ),
        'delivery'       => array( 'success', 'retry', 'failure', 'superseded' ),
        'embed_token'    => array( 'success', 'transport_error', 'http_error', 'invalid_response', 'configuration_error' ),
        'mapping_lookup' => array( 'cache_hit', 'cache_miss', 'success', 'transport_error', 'http_error', 'invalid_response', 'configuration_error' ),
        'outbox'         => array( 'enqueued', 'enqueue_failed', 'claimed' ),
        'reconciliation' => array( 'success', 'failure', 'lock_skipped', 'configuration_skipped' ),
        'scheduler'      => array( 'action_scheduler', 'wp_cron', 'failure' ),
        'sweep'          => array( 'success', 'failure' ),
    );

    private PKC_Outbox $outbox;

    /**
     * Register diagnostics.
     */
    public function __construct( PKC_Outbox $outbox ) {
        $this->outbox = $outbox;
        add_filter( 'site_status_tests', array( $this, 'register_site_health_tests' ) );
        add_filter( 'debug_information', array( $this, 'register_debug_information' ) );
        add_action( 'admin_post_pkc_reset_observability', array( $this, 'reset' ) );
    }

    /**
     * Increment one fixed metric without storing dimensions or payload data.
     */
    public static function record( string $metric, string $outcome, int $amount = 1 ): void {
        if ( $amount < 1 || ! self::is_allowed( $metric, $outcome ) ) {
            return;
        }
        global $wpdb;
        for ( $attempt = 0; $attempt < 3; ++$attempt ) {
            $serialized = $wpdb->get_var(
                $wpdb->prepare( "SELECT option_value FROM {$wpdb->options} WHERE option_name = %s", self::OPTION_STATE )
            );
            $current = null === $serialized ? null : maybe_unserialize( $serialized );
            $next = self::reduce_state( $current, $metric, $outcome, time(), $amount );
            if ( null === $serialized ) {
                if ( add_option( self::OPTION_STATE, $next, '', false ) ) {
                    return;
                }
            } else {
                $updated = $wpdb->query(
                    $wpdb->prepare(
                        "UPDATE {$wpdb->options} SET option_value = %s WHERE option_name = %s AND option_value = %s",
                        maybe_serialize( $next ),
                        self::OPTION_STATE,
                        $serialized
                    )
                );
                if ( 1 === $updated ) {
                    wp_cache_delete( self::OPTION_STATE, 'options' );
                    return;
                }
            }
            wp_cache_delete( self::OPTION_STATE, 'options' );
            wp_cache_delete( 'notoptions', 'options' );
        }
    }

    /**
     * Pure bounded state reducer used by runtime and standalone tests.
     *
     * @param mixed $raw_state Existing option value.
     * @return array<string, mixed>
     */
    public static function reduce_state( $raw_state, string $metric, string $outcome, int $timestamp, int $amount = 1 ): array {
        $state = self::normalize_state( $raw_state, $timestamp );
        if ( ! self::is_allowed( $metric, $outcome ) || $amount < 1 ) {
            return $state;
        }
        $day = gmdate( 'Y-m-d', $timestamp );
        $key = $metric . ':' . $outcome;
        if ( ! isset( $state['days'][ $day ] ) ) {
            $state['days'][ $day ] = array();
        }
        $current = (int) ( $state['days'][ $day ][ $key ] ?? 0 );
        $state['days'][ $day ][ $key ] = min( PHP_INT_MAX, $current + $amount );
        $state['last'][ $metric ] = array( 'outcome' => $outcome, 'timestamp' => $timestamp );
        if ( strlen( serialize( $state ) ) > self::MAX_STATE_BYTES ) {
            $state = self::empty_state();
            $state['days'][ $day ] = array( $key => min( PHP_INT_MAX, $amount ) );
            $state['last'][ $metric ] = array( 'outcome' => $outcome, 'timestamp' => $timestamp );
        }
        return $state;
    }

    /**
     * Return aggregate retained counters.
     *
     * @return array<string, int>
     */
    public static function summary(): array {
        $state = self::normalize_state( get_option( self::OPTION_STATE, null ), time() );
        $summary = array();
        foreach ( $state['days'] as $counters ) {
            foreach ( $counters as $key => $value ) {
                $summary[ $key ] = min( PHP_INT_MAX, (int) ( $summary[ $key ] ?? 0 ) + (int) $value );
            }
        }
        ksort( $summary );
        return $summary;
    }

    /**
     * Register direct Site Health tests.
     *
     * @param array<string, mixed> $tests Existing tests.
     * @return array<string, mixed>
     */
    public function register_site_health_tests( array $tests ): array {
        $tests['direct']['pkc_configuration'] = array( 'label' => __( 'PersonaliseKings connector configuration', 'personalise-kings-connector' ), 'test' => array( $this, 'test_configuration' ) );
        $tests['direct']['pkc_outbox'] = array( 'label' => __( 'PersonaliseKings delivery queue', 'personalise-kings-connector' ), 'test' => array( $this, 'test_outbox' ) );
        $tests['direct']['pkc_scheduler'] = array( 'label' => __( 'PersonaliseKings connector scheduler', 'personalise-kings-connector' ), 'test' => array( $this, 'test_scheduler' ) );
        $tests['direct']['pkc_api'] = array( 'label' => __( 'PersonaliseKings API reachability', 'personalise-kings-connector' ), 'test' => array( $this, 'test_api' ) );
        return $tests;
    }

    /**
     * Site Health configuration test.
     *
     * @return array<string, mixed>
     */
    public function test_configuration(): array {
        $configured = PKC_Settings::is_valid_endpoint_url( (string) get_option( PKC_Settings::OPTION_API_URL, '' ) )
            && '' !== (string) get_option( PKC_Settings::OPTION_STORE_ID, '' )
            && null !== PKC_Settings::signing_credential();
        return $this->health_result(
            'pkc_configuration',
            $configured ? 'good' : 'critical',
            $configured ? __( 'Connector configuration is complete.', 'personalise-kings-connector' ) : __( 'Connector endpoint, store binding, or signing credential is incomplete.', 'personalise-kings-connector' )
        );
    }

    /**
     * Site Health queue test.
     *
     * @return array<string, mixed>
     */
    public function test_outbox(): array {
        $snapshot = $this->outbox->health_snapshot();
        $classification = self::classify_queue_health( $snapshot );
        return $this->health_result( 'pkc_outbox', $classification['status'], $classification['message'] );
    }

    /**
     * Site Health scheduler test.
     *
     * @return array<string, mixed>
     */
    public function test_scheduler(): array {
        $scheduler = $this->scheduler_snapshot();
        $queue = $this->outbox->health_snapshot();
        $missing = empty( $scheduler['next_sweep'] ) || empty( $scheduler['next_reconciliation'] );
        $status = $missing && (int) $queue['pending'] > 0 ? 'critical' : ( $missing ? 'recommended' : 'good' );
        $message = $missing ? __( 'A recurring connector task is not scheduled.', 'personalise-kings-connector' ) : __( 'Recurring connector tasks are scheduled.', 'personalise-kings-connector' );
        return $this->health_result( 'pkc_scheduler', $status, $message );
    }

    /**
     * Site Health API liveness probe. No store or credential data is sent.
     *
     * @return array<string, mixed>
     */
    public function test_api(): array {
        $api_url = rtrim( (string) get_option( PKC_Settings::OPTION_API_URL, '' ), '/' );
        if ( ! PKC_Settings::is_valid_endpoint_url( $api_url ) ) {
            return $this->health_result( 'pkc_api', 'critical', __( 'The connector API URL is invalid.', 'personalise-kings-connector' ) );
        }
        $response = wp_safe_remote_get(
            $api_url . '/health',
            array(
                'timeout'             => 5,
                'redirection'         => 0,
                'limit_response_size' => 4096,
                'user-agent'          => 'PersonaliseKings-Connector/' . PKC_VERSION,
            )
        );
        $status = is_wp_error( $response ) ? 0 : (int) wp_remote_retrieve_response_code( $response );
        return $this->health_result(
            'pkc_api',
            200 === $status ? 'good' : 'recommended',
            200 === $status ? __( 'The PersonaliseKings API is reachable.', 'personalise-kings-connector' ) : __( 'The PersonaliseKings API liveness endpoint could not be reached.', 'personalise-kings-connector' )
        );
    }

    /**
     * Add strictly allowlisted Site Health debug fields.
     *
     * @param array<string, mixed> $information Existing information.
     * @return array<string, mixed>
     */
    public function register_debug_information( array $information ): array {
        $snapshot = $this->outbox->health_snapshot();
        $summary = self::summary();
        $scheduler = $this->scheduler_snapshot();
        $information['personalise_kings_connector'] = array(
            'label'  => __( 'PersonaliseKings Connector', 'personalise-kings-connector' ),
            'fields' => array(
                'plugin_version'       => array( 'label' => __( 'Plugin version', 'personalise-kings-connector' ), 'value' => PKC_VERSION ),
                'database_version'     => array( 'label' => __( 'Database version', 'personalise-kings-connector' ), 'value' => PKC_DB_VERSION ),
                'schema_available'     => array( 'label' => __( 'Queue schema available', 'personalise-kings-connector' ), 'value' => $snapshot['available'] ? 'yes' : 'no' ),
                'pending_deliveries'   => array( 'label' => __( 'Pending deliveries', 'personalise-kings-connector' ), 'value' => (int) $snapshot['pending'] ),
                'processing_deliveries'=> array( 'label' => __( 'Processing deliveries', 'personalise-kings-connector' ), 'value' => (int) $snapshot['processing'] ),
                'failed_deliveries'    => array( 'label' => __( 'Failed deliveries', 'personalise-kings-connector' ), 'value' => (int) $snapshot['failed'] ),
                'oldest_due_age'       => array( 'label' => __( 'Oldest due age (seconds)', 'personalise-kings-connector' ), 'value' => (int) $snapshot['oldest_due_age'] ),
                'stale_claims'         => array( 'label' => __( 'Stale claims', 'personalise-kings-connector' ), 'value' => (int) $snapshot['stale_claims'] ),
                'scheduler_backend'     => array( 'label' => __( 'Scheduler backend', 'personalise-kings-connector' ), 'value' => $scheduler['backend'] ),
                'next_sweep'            => array( 'label' => __( 'Next queue sweep (UTC)', 'personalise-kings-connector' ), 'value' => $scheduler['next_sweep'] ? gmdate( 'c', $scheduler['next_sweep'] ) : 'not scheduled' ),
                'next_reconciliation'   => array( 'label' => __( 'Next reconciliation (UTC)', 'personalise-kings-connector' ), 'value' => $scheduler['next_reconciliation'] ? gmdate( 'c', $scheduler['next_reconciliation'] ) : 'not scheduled' ),
                'retained_counters'    => array( 'label' => __( '14-day counters', 'personalise-kings-connector' ), 'value' => wp_json_encode( $summary ) ),
            ),
        );
        return $information;
    }

    /**
     * Classify a live queue snapshot without inspecting payloads.
     *
     * @param array<string, mixed> $snapshot Queue snapshot.
     * @return array{status:string,message:string}
     */
    public static function classify_queue_health( array $snapshot ): array {
        if ( empty( $snapshot['available'] ) ) {
            return array( 'status' => 'critical', 'message' => 'The connector queue schema is unavailable.' );
        }
        if ( (int) ( $snapshot['stale_claims'] ?? 0 ) > 0 || (int) ( $snapshot['oldest_due_age'] ?? 0 ) > 15 * MINUTE_IN_SECONDS ) {
            return array( 'status' => 'critical', 'message' => 'Connector deliveries are stale or overdue.' );
        }
        if ( (int) ( $snapshot['failed'] ?? 0 ) > 0 ) {
            return array( 'status' => 'recommended', 'message' => 'Connector deliveries require review.' );
        }
        return array( 'status' => 'good', 'message' => 'The connector delivery queue is healthy.' );
    }

    /**
     * Return scheduler backend and next-run timestamps without identifiers.
     *
     * @return array{backend:string,next_sweep:int,next_reconciliation:int}
     */
    public function scheduler_snapshot(): array {
        $action_scheduler = function_exists( 'as_next_scheduled_action' );
        $as_sweep = $action_scheduler ? as_next_scheduled_action( 'pkc_sweep_outbox', array(), 'personalise-kings-connector' ) : 0;
        $as_reconciliation = $action_scheduler ? as_next_scheduled_action( 'pkc_reconcile_modified_orders', array(), 'personalise-kings-connector' ) : 0;
        $cron_sweep = wp_next_scheduled( 'pkc_sweep_outbox' );
        $cron_reconciliation = wp_next_scheduled( 'pkc_reconcile_modified_orders' );
        $next_sweep = is_numeric( $as_sweep ) && (int) $as_sweep > 0 ? $as_sweep : $cron_sweep;
        $next_reconciliation = is_numeric( $as_reconciliation ) && (int) $as_reconciliation > 0 ? $as_reconciliation : $cron_reconciliation;
        $uses_action_scheduler = ( is_numeric( $as_sweep ) && (int) $as_sweep > 0 ) || ( is_numeric( $as_reconciliation ) && (int) $as_reconciliation > 0 );
        $uses_wp_cron = ( is_numeric( $cron_sweep ) && (int) $cron_sweep > 0 ) || ( is_numeric( $cron_reconciliation ) && (int) $cron_reconciliation > 0 );
        return array(
            'backend'             => $uses_action_scheduler && $uses_wp_cron ? 'mixed' : ( $uses_action_scheduler ? 'action_scheduler' : 'wp_cron' ),
            'next_sweep'          => is_numeric( $next_sweep ) ? (int) $next_sweep : 0,
            'next_reconciliation' => is_numeric( $next_reconciliation ) ? (int) $next_reconciliation : 0,
        );
    }

    /**
     * Reset diagnostic counters only.
     */
    public function reset(): void {
        if ( ! current_user_can( 'manage_woocommerce' ) ) {
            wp_die( esc_html__( 'You are not allowed to reset connector diagnostics.', 'personalise-kings-connector' ) );
        }
        check_admin_referer( 'pkc_reset_observability' );
        delete_option( self::OPTION_STATE );
        wp_safe_redirect( admin_url( 'admin.php?page=personalise-kings-connector&pkc_diagnostics_reset=1' ) );
        exit;
    }

    /**
     * Normalize and prune untrusted stored state.
     *
     * @param mixed $raw_state Stored option.
     * @return array<string, mixed>
     */
    private static function normalize_state( $raw_state, int $timestamp ): array {
        $state = self::empty_state();
        if ( ! is_array( $raw_state ) || self::STATE_VERSION !== (int) ( $raw_state['version'] ?? 0 ) || strlen( serialize( $raw_state ) ) > self::MAX_STATE_BYTES ) {
            return $state;
        }
        $cutoff = gmdate( 'Y-m-d', $timestamp - ( self::RETENTION_DAYS - 1 ) * DAY_IN_SECONDS );
        $today = gmdate( 'Y-m-d', $timestamp );
        foreach ( is_array( $raw_state['days'] ?? null ) ? $raw_state['days'] : array() as $day => $counters ) {
            if ( ! is_string( $day ) || $day < $cutoff || $day > $today || ! is_array( $counters ) ) {
                continue;
            }
            foreach ( $counters as $key => $value ) {
                $parts = is_string( $key ) ? explode( ':', $key, 2 ) : array();
                if ( 2 === count( $parts ) && self::is_allowed( $parts[0], $parts[1] ) && is_numeric( $value ) && (int) $value >= 0 ) {
                    $state['days'][ $day ][ $key ] = min( PHP_INT_MAX, (int) $value );
                }
            }
        }
        foreach ( is_array( $raw_state['last'] ?? null ) ? $raw_state['last'] : array() as $metric => $last ) {
            if ( is_array( $last ) && self::is_allowed( (string) $metric, (string) ( $last['outcome'] ?? '' ) ) && (int) ( $last['timestamp'] ?? 0 ) > 0 ) {
                $state['last'][ $metric ] = array( 'outcome' => (string) $last['outcome'], 'timestamp' => (int) $last['timestamp'] );
            }
        }
        return $state;
    }

    /**
     * Return an empty state envelope.
     *
     * @return array<string, mixed>
     */
    private static function empty_state(): array {
        return array( 'version' => self::STATE_VERSION, 'days' => array(), 'last' => array() );
    }

    private static function is_allowed( string $metric, string $outcome ): bool {
        return isset( self::METRICS[ $metric ] ) && in_array( $outcome, self::METRICS[ $metric ], true );
    }

    /**
     * Build one standard Site Health result.
     *
     * @return array<string, mixed>
     */
    private function health_result( string $test, string $status, string $description ): array {
        return array(
            'label'       => __( 'PersonaliseKings connector', 'personalise-kings-connector' ),
            'status'      => $status,
            'badge'       => array( 'label' => __( 'PersonaliseKings', 'personalise-kings-connector' ), 'color' => 'blue' ),
            'description' => '<p>' . esc_html( $description ) . '</p>',
            'actions'     => '',
            'test'        => $test,
        );
    }
}
