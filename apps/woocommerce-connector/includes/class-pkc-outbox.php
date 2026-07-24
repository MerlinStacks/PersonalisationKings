<?php
/**
 * Durable connector outbox.
 *
 * @package PersonaliseKingsConnector
 */

defined( 'ABSPATH' ) || exit;

/**
 * Persists logical connector events independently from scheduler wake-ups.
 */
class PKC_Outbox {
    public const STATUS_PENDING = 'pending';
    public const STATUS_RETRY_WAIT = 'retry_wait';
    public const STATUS_PROCESSING = 'processing';
    public const STATUS_DELIVERED = 'delivered';
    public const STATUS_FAILED = 'failed';
    public const STATUS_CANCELLED = 'cancelled';
    public const STATUS_SUPERSEDED = 'superseded';

    private const OPTION_DB_VERSION = 'pkc_db_version';
    private const OPTION_SCHEMA_CHECKED_AT = 'pkc_outbox_schema_checked_at';
    private const OPTION_LAST_CLEANUP = 'pkc_outbox_last_cleanup';
    private const OPTION_PENDING_QUARANTINE = 'pkc_outbox_pending_quarantine';
    private const CLAIM_TIMEOUT = 15 * MINUTE_IN_SECONDS;

    private string $table_name;
    private bool $available;

    /**
     * Constructor.
     */
    public function __construct() {
        global $wpdb;
        $this->table_name = $wpdb->prefix . 'pkc_outbox';
        $this->available = $this->maybe_install();
    }

    /**
     * Create or upgrade the local outbox table.
     */
    public static function install(): bool {
        global $wpdb;
        require_once ABSPATH . 'wp-admin/includes/upgrade.php';

        $table_name = $wpdb->prefix . 'pkc_outbox';
        $charset_collate = $wpdb->get_charset_collate();
        $sql = "CREATE TABLE {$table_name} (
            id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
            identity_hash char(64) NOT NULL,
            order_id bigint(20) unsigned NOT NULL,
            event_type varchar(32) NOT NULL,
            event_key varchar(255) NOT NULL,
            occurred_at_gmt datetime NOT NULL,
            store_id varchar(191) NULL,
            connector_instance_id varchar(255) NULL,
            event_id varchar(80) NULL,
            nonce varchar(64) NULL,
            idempotency_key varchar(255) NULL,
            payload_json longtext NULL,
            status varchar(20) NOT NULL,
            attempt_count int(10) unsigned NOT NULL DEFAULT 0,
            next_attempt_gmt datetime NULL,
            claim_token char(36) NULL,
            claimed_at_gmt datetime NULL,
            generation int(10) unsigned NOT NULL DEFAULT 1,
            scheduled_action_id bigint(20) unsigned NULL,
            last_attempt_gmt datetime NULL,
            last_http_status smallint(5) unsigned NULL,
            last_error text NULL,
            finished_at_gmt datetime NULL,
            last_admin_user_id bigint(20) unsigned NULL,
            legacy_action_id bigint(20) unsigned NOT NULL DEFAULT 0,
            legacy_hook varchar(191) NULL,
            created_at_gmt datetime NOT NULL,
            updated_at_gmt datetime NOT NULL,
            PRIMARY KEY  (id),
            UNIQUE KEY identity_hash (identity_hash),
            KEY status_next (status, next_attempt_gmt),
            KEY order_created (order_id, created_at_gmt),
            KEY status_finished (status, finished_at_gmt),
            KEY legacy_action (legacy_action_id)
        ) {$charset_collate};";
        $previous_version = (string) get_option( self::OPTION_DB_VERSION, '' );
        if ( in_array( $previous_version, array( '1.1.0', '1.2.0' ), true ) ) {
            update_option( self::OPTION_PENDING_QUARANTINE, 1, false );
        }
        $needs_quarantine = 1 === (int) get_option( self::OPTION_PENDING_QUARANTINE, 0 );
        $needs_identity_migration = PKC_DB_VERSION !== $previous_version || $needs_quarantine;
        dbDelta( $sql );
        $migration_error = $wpdb->last_error;
        $now = gmdate( 'Y-m-d H:i:s' );
        $connector_instance_id = home_url();
        if ( '' === $migration_error ) {
            $wpdb->query(
                $wpdb->prepare(
                    "UPDATE {$table_name} SET connector_instance_id = %s
                     WHERE connector_instance_id IS NULL OR connector_instance_id = ''",
                    $connector_instance_id
                )
            );
            $migration_error = $wpdb->last_error;
        }
        if ( '' === $migration_error && $needs_quarantine ) {
            $wpdb->query(
                $wpdb->prepare(
                    "UPDATE {$table_name}
                     SET store_id = '', status = %s, next_attempt_gmt = NULL,
                         event_id = NULL, nonce = NULL, idempotency_key = NULL, payload_json = NULL,
                         last_error = %s, finished_at_gmt = %s, updated_at_gmt = %s
                     WHERE status IN (%s, %s, %s, %s)",
                    self::STATUS_FAILED,
                    'Store binding created by a draft outbox version is untrusted; create a fresh manual resync.',
                    $now,
                    $now,
                    self::STATUS_PENDING,
                    self::STATUS_RETRY_WAIT,
                    self::STATUS_PROCESSING,
                    self::STATUS_FAILED
                )
            );
            $migration_error = $wpdb->last_error;
        }
        if ( '' === $migration_error ) {
            $wpdb->query(
                $wpdb->prepare(
                    "UPDATE {$table_name}
                     SET status = %s, next_attempt_gmt = NULL, last_error = %s,
                         finished_at_gmt = %s, updated_at_gmt = %s
                     WHERE (store_id IS NULL OR store_id = '') AND status IN (%s, %s, %s)",
                    self::STATUS_FAILED,
                    'Legacy event has no store binding; create a fresh manual resync after connecting the store.',
                    $now,
                    $now,
                    self::STATUS_PENDING,
                    self::STATUS_RETRY_WAIT,
                    self::STATUS_PROCESSING
                )
            );
            $migration_error = $wpdb->last_error;
        }
        if ( '' === $migration_error && $needs_identity_migration ) {
            $wpdb->query(
                "UPDATE {$table_name}
                 SET identity_hash = CASE
                    WHEN store_id IS NULL OR store_id = ''
                    THEN SHA2(CONCAT('quarantine|', id, '|', order_id, '|', event_type, '|', event_key), 256)
                    ELSE SHA2(CONCAT(store_id, '|', order_id, '|', event_type, '|', event_key), 256)
                 END"
            );
            $migration_error = $wpdb->last_error;
        }
        if ( '' === $migration_error && self::schema_is_valid( $table_name ) ) {
            update_option( self::OPTION_DB_VERSION, PKC_DB_VERSION, false );
            update_option( self::OPTION_SCHEMA_CHECKED_AT, time(), false );
            delete_option( self::OPTION_PENDING_QUARANTINE );
            return true;
        }
        delete_option( self::OPTION_DB_VERSION );
        delete_option( self::OPTION_SCHEMA_CHECKED_AT );
        return false;
    }

    /**
     * Install schema changes after plugin updates that do not run activation hooks.
     */
    private function maybe_install(): bool {
        global $wpdb;
        $version_current = PKC_DB_VERSION === (string) get_option( self::OPTION_DB_VERSION, '' );
        $recently_checked = (int) get_option( self::OPTION_SCHEMA_CHECKED_AT, 0 ) > time() - HOUR_IN_SECONDS;
        if ( $version_current && $recently_checked ) {
            return true;
        }
        if ( ! $version_current || ! self::schema_is_valid( $wpdb->prefix . 'pkc_outbox' ) ) {
            return self::install();
        }
        update_option( self::OPTION_SCHEMA_CHECKED_AT, time(), false );
        return true;
    }

    /**
     * Verify every column and the identity uniqueness required for safe dispatch.
     *
     * @param string $table_name Outbox table name.
     */
    private static function schema_is_valid( string $table_name ): bool {
        global $wpdb;
        $installed_table = $wpdb->get_var(
            $wpdb->prepare( 'SHOW TABLES LIKE %s', $wpdb->esc_like( $table_name ) )
        );
        if ( $table_name !== $installed_table ) {
            return false;
        }
        $column_rows = $wpdb->get_results( "SHOW COLUMNS FROM `{$table_name}`", ARRAY_A );
        $columns = array();
        foreach ( is_array( $column_rows ) ? $column_rows : array() as $column ) {
            $columns[ (string) $column['Field'] ] = $column;
        }
        $required_columns = array(
            'id', 'identity_hash', 'order_id', 'event_type', 'event_key', 'occurred_at_gmt',
            'store_id', 'connector_instance_id', 'event_id', 'nonce', 'idempotency_key',
            'payload_json', 'status', 'attempt_count', 'next_attempt_gmt', 'claim_token',
            'claimed_at_gmt', 'generation', 'scheduled_action_id', 'last_attempt_gmt',
            'last_http_status', 'last_error', 'finished_at_gmt', 'last_admin_user_id',
            'legacy_action_id', 'legacy_hook', 'created_at_gmt', 'updated_at_gmt',
        );
        if ( array_diff( $required_columns, array_keys( $columns ) ) ) {
            return false;
        }
        if ( 'PRI' !== (string) $columns['id']['Key']
            || ! str_contains( strtolower( (string) $columns['id']['Type'] ), 'bigint' )
            || ! str_contains( strtolower( (string) $columns['id']['Type'] ), 'unsigned' )
            || ! str_contains( strtolower( (string) $columns['id']['Extra'] ), 'auto_increment' ) ) {
            return false;
        }
        if ( ! str_starts_with( strtolower( (string) $columns['identity_hash']['Type'] ), 'char(64)' )
            || ! str_starts_with( strtolower( (string) $columns['status']['Type'] ), 'varchar(20)' )
            || ! str_contains( strtolower( (string) $columns['generation']['Type'] ), 'unsigned' )
            || ! str_contains( strtolower( (string) $columns['next_attempt_gmt']['Type'] ), 'datetime' )
            || ! str_contains( strtolower( (string) $columns['payload_json']['Type'] ), 'longtext' ) ) {
            return false;
        }
        $index_rows = $wpdb->get_results( "SHOW INDEX FROM `{$table_name}`", ARRAY_A );
        $indexes = array();
        foreach ( is_array( $index_rows ) ? $index_rows : array() as $index ) {
            $indexes[ (string) $index['Key_name'] ][ (int) $index['Seq_in_index'] ] = (string) $index['Column_name'];
            if ( 'identity_hash' === (string) $index['Key_name'] && 0 !== (int) $index['Non_unique'] ) {
                return false;
            }
        }
        return isset( $indexes['PRIMARY'], $indexes['identity_hash'], $indexes['status_next'], $indexes['order_created'], $indexes['status_finished'], $indexes['legacy_action'] )
            && array_values( $indexes['PRIMARY'] ) === array( 'id' )
            && array_values( $indexes['identity_hash'] ) === array( 'identity_hash' )
            && array_values( $indexes['status_next'] ) === array( 'status', 'next_attempt_gmt' )
            && array_values( $indexes['order_created'] ) === array( 'order_id', 'created_at_gmt' )
            && array_values( $indexes['status_finished'] ) === array( 'status', 'finished_at_gmt' )
            && array_values( $indexes['legacy_action'] ) === array( 'legacy_action_id' );
    }

    /**
     * Whether the authoritative queue schema is safe to use.
     */
    public function is_available(): bool {
        return $this->available;
    }

    /**
     * Insert one logical event, returning an existing row for exact duplicates.
     *
     * @param int    $order_id   WooCommerce order ID.
     * @param string $event_type Connector event type.
     * @param string $event_key  Stable occurrence key.
     * @param string $occurred_at RFC 3339 occurrence timestamp.
     * @param string $store_id    Store binding at enqueue time, or an empty string.
     * @param string $connector_instance_id Connector site identity.
     * @param int    $attempt     Queued legacy attempt number.
     * @param int    $available_at Unix timestamp when processing may start.
     * @return array<string, mixed>|null
     */
    public function enqueue( int $order_id, string $event_type, string $event_key, string $occurred_at, string $store_id, string $connector_instance_id, int $attempt, int $available_at ): ?array {
        if ( ! $this->available || strlen( $event_type ) > 32 || strlen( $event_key ) > 255 || strlen( $store_id ) > 191 || strlen( $connector_instance_id ) > 255 ) {
            return null;
        }
        global $wpdb;
        $identity_hash = hash( 'sha256', $store_id . '|' . $order_id . '|' . $event_type . '|' . $event_key );
        $now = gmdate( 'Y-m-d H:i:s' );
        $occurred_timestamp = strtotime( $occurred_at );
        $occurred_gmt = gmdate( 'Y-m-d H:i:s', false === $occurred_timestamp ? time() : $occurred_timestamp );
        $next_attempt_gmt = gmdate( 'Y-m-d H:i:s', $available_at );

        $inserted = $wpdb->query(
            $wpdb->prepare(
                "INSERT INTO {$this->table_name}
                    (identity_hash, order_id, event_type, event_key, occurred_at_gmt, store_id, connector_instance_id, status, attempt_count, next_attempt_gmt, generation, created_at_gmt, updated_at_gmt)
                 VALUES (%s, %d, %s, %s, %s, %s, %s, %s, %d, %s, 1, %s, %s)
                 ON DUPLICATE KEY UPDATE identity_hash = VALUES(identity_hash)",
                $identity_hash,
                $order_id,
                $event_type,
                $event_key,
                $occurred_gmt,
                $store_id,
                $connector_instance_id,
                self::STATUS_PENDING,
                max( 0, $attempt - 1 ),
                $next_attempt_gmt,
                $now,
                $now
            )
        );
        if ( false === $inserted ) {
            if ( class_exists( 'PKC_Observability' ) ) {
                PKC_Observability::record( 'outbox', 'enqueue_failed' );
            }
            return null;
        }
        if ( 1 === $inserted && class_exists( 'PKC_Observability' ) ) {
            PKC_Observability::record( 'outbox', 'enqueued' );
        }
        return $this->get_by_identity( $identity_hash );
    }

    /**
     * Atomically preserve an untrusted legacy action as failed and inspectable.
     *
     * @param int    $order_id   WooCommerce order ID.
     * @param string $event_type Connector event type.
     * @param string $event_key  Stable occurrence key.
     * @param string $occurred_at RFC 3339 occurrence timestamp.
     * @param string $connector_instance_id Connector site identity.
     * @param int    $attempt Attempt number recorded by the legacy action.
     * @param string $error   Quarantine reason.
     * @param int    $legacy_action_id Legacy Action Scheduler ID.
     * @param string $legacy_hook Legacy scheduler hook.
     * @return array<string, mixed>|null
     */
    public function enqueue_failed( int $order_id, string $event_type, string $event_key, string $occurred_at, string $connector_instance_id, int $attempt, string $error, int $legacy_action_id = 0, string $legacy_hook = '' ): ?array {
        if ( ! $this->available || strlen( $event_type ) > 32 || strlen( $event_key ) > 255 || strlen( $connector_instance_id ) > 255 || strlen( $legacy_hook ) > 191 ) {
            return null;
        }
        global $wpdb;
        $identity_hash = hash( 'sha256', '|' . $order_id . '|' . $event_type . '|' . $event_key );
        $now = gmdate( 'Y-m-d H:i:s' );
        $occurred_timestamp = strtotime( $occurred_at );
        $occurred_gmt = gmdate( 'Y-m-d H:i:s', false === $occurred_timestamp ? time() : $occurred_timestamp );
        $inserted = $wpdb->query(
            $wpdb->prepare(
                "INSERT INTO {$this->table_name}
                    (identity_hash, order_id, event_type, event_key, occurred_at_gmt, store_id, connector_instance_id,
                     status, attempt_count, next_attempt_gmt, generation, last_error, finished_at_gmt,
                     legacy_action_id, legacy_hook, created_at_gmt, updated_at_gmt)
                 VALUES (%s, %d, %s, %s, %s, '', %s, %s, %d, NULL, 1, %s, %s, %d, %s, %s, %s)
                 ON DUPLICATE KEY UPDATE
                    legacy_action_id = IF(legacy_action_id = 0, VALUES(legacy_action_id), legacy_action_id),
                    legacy_hook = IF(legacy_hook IS NULL OR legacy_hook = '', VALUES(legacy_hook), legacy_hook)",
                $identity_hash,
                $order_id,
                $event_type,
                $event_key,
                $occurred_gmt,
                $connector_instance_id,
                self::STATUS_FAILED,
                max( 1, $attempt ),
                $this->bounded_error( $error ),
                $now,
                max( 0, $legacy_action_id ),
                $legacy_hook,
                $now,
                $now
            )
        );
        if ( false === $inserted ) {
            return null;
        }
        $row = $this->get_by_identity( $identity_hash );
        if ( is_array( $row ) && self::STATUS_FAILED !== (string) $row['status'] ) {
            $this->import_failed( (int) $row['id'], $error );
            $row = $this->get( (int) $row['id'] );
        }
        return is_array( $row ) ? $row : null;
    }

    /**
     * Whether one failed legacy Action Scheduler record has been adopted.
     *
     * @param int $action_id Action Scheduler ID.
     */
    public function has_legacy_action( int $action_id ): bool {
        if ( ! $this->available || $action_id <= 0 ) {
            return false;
        }
        global $wpdb;
        return (bool) $wpdb->get_var(
            $wpdb->prepare( "SELECT id FROM {$this->table_name} WHERE legacy_action_id = %d LIMIT 1", $action_id )
        );
    }

    /**
     * Get one outbox row.
     *
     * @param int $id Outbox row ID.
     * @return array<string, mixed>|null
     */
    public function get( int $id ): ?array {
        if ( ! $this->available ) {
            return null;
        }
        global $wpdb;
        $row = $wpdb->get_row(
            $wpdb->prepare( "SELECT * FROM {$this->table_name} WHERE id = %d", $id ),
            ARRAY_A
        );
        return is_array( $row ) ? $row : null;
    }

    /**
     * Get one row by its immutable identity hash.
     *
     * @param string $identity_hash Identity hash.
     * @return array<string, mixed>|null
     */
    private function get_by_identity( string $identity_hash ): ?array {
        if ( ! $this->available ) {
            return null;
        }
        global $wpdb;
        $row = $wpdb->get_row(
            $wpdb->prepare( "SELECT * FROM {$this->table_name} WHERE identity_hash = %s", $identity_hash ),
            ARRAY_A
        );
        return is_array( $row ) ? $row : null;
    }

    /**
     * Claim a due row for one scheduler generation.
     *
     * @param int $id         Outbox row ID.
     * @param int $generation Scheduler generation.
     * @return array<string, mixed>|null
     */
    public function claim( int $id, int $generation ): ?array {
        if ( ! $this->available ) {
            return null;
        }
        global $wpdb;
        $token = wp_generate_uuid4();
        $now = gmdate( 'Y-m-d H:i:s' );
        $updated = $wpdb->query(
            $wpdb->prepare(
                "UPDATE {$this->table_name}
                 SET status = %s, claim_token = %s, claimed_at_gmt = %s, last_attempt_gmt = %s,
                     attempt_count = attempt_count + 1, scheduled_action_id = NULL, updated_at_gmt = %s
                 WHERE id = %d AND generation = %d AND status IN (%s, %s)
                   AND (next_attempt_gmt IS NULL OR next_attempt_gmt <= %s)",
                self::STATUS_PROCESSING,
                $token,
                $now,
                $now,
                $now,
                $id,
                $generation,
                self::STATUS_PENDING,
                self::STATUS_RETRY_WAIT,
                $now
            )
        );
        if ( 1 !== $updated ) {
            return null;
        }
        if ( class_exists( 'PKC_Observability' ) ) {
            PKC_Observability::record( 'outbox', 'claimed' );
        }
        return $this->get( $id );
    }

    /**
     * Freeze the store binding and signed event data before the first request.
     *
     * @param int    $id              Outbox row ID.
     * @param string $claim_token     Claim owner token.
     * @param string $store_id        PersonaliseKings store ID.
     * @param string $event_id        Connector event ID.
     * @param string $nonce           Replay nonce.
     * @param string $idempotency_key Payload idempotency key.
     * @param string $payload_json    Encoded payload.
     */
    public function materialize( int $id, string $claim_token, string $store_id, string $event_id, string $nonce, string $idempotency_key, string $payload_json ): bool {
        if ( ! $this->available ) {
            return false;
        }
        global $wpdb;
        $updated = $wpdb->query(
            $wpdb->prepare(
                "UPDATE {$this->table_name}
                 SET event_id = %s, nonce = %s, idempotency_key = %s, payload_json = %s, updated_at_gmt = %s
                 WHERE id = %d AND status = %s AND claim_token = %s AND payload_json IS NULL
                   AND store_id = %s",
                $event_id,
                $nonce,
                $idempotency_key,
                $payload_json,
                gmdate( 'Y-m-d H:i:s' ),
                $id,
                self::STATUS_PROCESSING,
                $claim_token,
                $store_id
            )
        );
        return 1 === $updated;
    }

    /**
     * Renew claim ownership immediately before network I/O.
     *
     * @param int    $id          Outbox row ID.
     * @param string $claim_token Claim owner token.
     */
    public function renew_claim( int $id, string $claim_token ): bool {
        if ( ! $this->available ) {
            return false;
        }
        global $wpdb;
        $updated = $wpdb->query(
            $wpdb->prepare(
                "UPDATE {$this->table_name} SET claimed_at_gmt = %s, updated_at_gmt = %s
                 WHERE id = %d AND status = %s AND claim_token = %s",
                gmdate( 'Y-m-d H:i:s' ),
                gmdate( 'Y-m-d H:i:s' ),
                $id,
                self::STATUS_PROCESSING,
                $claim_token
            )
        );
        if ( 1 === $updated ) {
            return true;
        }
        if ( false === $updated ) {
            return false;
        }
        $owned = $wpdb->get_var(
            $wpdb->prepare(
                "SELECT id FROM {$this->table_name} WHERE id = %d AND status = %s AND claim_token = %s",
                $id,
                self::STATUS_PROCESSING,
                $claim_token
            )
        );
        return (int) $owned === $id;
    }

    /**
     * Mark a claimed row delivered.
     *
     * @param int    $id          Outbox row ID.
     * @param string $claim_token Claim owner token.
     * @param int    $http_status HTTP response status.
     */
    public function mark_delivered( int $id, string $claim_token, int $http_status ): bool {
        return $this->finish_claim( $id, $claim_token, self::STATUS_DELIVERED, null, $http_status );
    }

    /**
     * Mark a claimed row permanently failed.
     *
     * @param int      $id          Outbox row ID.
     * @param string   $claim_token Claim owner token.
     * @param string   $error       Failure message.
     * @param int|null $http_status HTTP response status.
     */
    public function mark_failed( int $id, string $claim_token, string $error, ?int $http_status = null ): bool {
        return $this->finish_claim( $id, $claim_token, self::STATUS_FAILED, $error, $http_status );
    }

    /**
     * Mark a stale occurrence superseded by a newly persisted snapshot.
     *
     * @param int    $id          Outbox row ID.
     * @param string $claim_token Claim owner token.
     * @param string $reason      Supersession reason.
     */
    public function mark_superseded( int $id, string $claim_token, string $reason ): bool {
        return $this->finish_claim( $id, $claim_token, self::STATUS_SUPERSEDED, $reason, null );
    }

    /**
     * Move a claimed row into retry wait and invalidate its previous wake-up.
     *
     * @param int      $id              Outbox row ID.
     * @param string   $claim_token     Claim owner token.
     * @param int      $next_attempt_at Unix retry time.
     * @param string   $error           Failure message.
     * @param int|null $http_status     HTTP response status.
     * @return array<string, mixed>|null
     */
    public function mark_retry( int $id, string $claim_token, int $next_attempt_at, string $error, ?int $http_status = null ): ?array {
        if ( ! $this->available ) {
            return null;
        }
        global $wpdb;
        $now = gmdate( 'Y-m-d H:i:s' );
        $updated = $wpdb->query(
            $wpdb->prepare(
                "UPDATE {$this->table_name}
                 SET status = %s, next_attempt_gmt = %s, last_http_status = %d, last_error = %s,
                     claim_token = NULL, claimed_at_gmt = NULL, generation = generation + 1,
                     scheduled_action_id = NULL, updated_at_gmt = %s
                 WHERE id = %d AND status = %s AND claim_token = %s",
                self::STATUS_RETRY_WAIT,
                gmdate( 'Y-m-d H:i:s', $next_attempt_at ),
                $http_status ?? 0,
                $this->bounded_error( $error ),
                $now,
                $id,
                self::STATUS_PROCESSING,
                $claim_token
            )
        );
        if ( 1 === $updated && class_exists( 'PKC_Observability' ) ) {
            PKC_Observability::record( 'delivery', 'retry' );
        }
        return 1 === $updated ? $this->get( $id ) : null;
    }

    /**
     * Finish a claimed row in a terminal state.
     *
     * @param int      $id          Outbox row ID.
     * @param string   $claim_token Claim owner token.
     * @param string   $status      Terminal status.
     * @param string|null $error    Outcome detail.
     * @param int|null $http_status HTTP response status.
     */
    private function finish_claim( int $id, string $claim_token, string $status, ?string $error, ?int $http_status ): bool {
        if ( ! $this->available ) {
            return false;
        }
        global $wpdb;
        $now = gmdate( 'Y-m-d H:i:s' );
        $updated = $wpdb->query(
            $wpdb->prepare(
                "UPDATE {$this->table_name}
                 SET status = %s, next_attempt_gmt = NULL, last_http_status = %d, last_error = %s,
                     claim_token = NULL, claimed_at_gmt = NULL, scheduled_action_id = NULL,
                     finished_at_gmt = %s, updated_at_gmt = %s
                 WHERE id = %d AND status = %s AND claim_token = %s",
                $status,
                $http_status ?? 0,
                null === $error ? null : $this->bounded_error( $error ),
                $now,
                $now,
                $id,
                self::STATUS_PROCESSING,
                $claim_token
            )
        );
        if ( 1 === $updated && class_exists( 'PKC_Observability' ) ) {
            $outcome = self::STATUS_DELIVERED === $status ? 'success' : ( self::STATUS_SUPERSEDED === $status ? 'superseded' : 'failure' );
            PKC_Observability::record( 'delivery', $outcome );
        }
        return 1 === $updated;
    }

    /**
     * Associate a disposable scheduler action with its current generation.
     *
     * @param int $id         Outbox row ID.
     * @param int $generation Scheduler generation.
     * @param int $action_id  Action Scheduler ID, or zero for WP-Cron.
     */
    public function set_scheduled_action( int $id, int $generation, int $action_id ): void {
        if ( ! $this->available ) {
            return;
        }
        global $wpdb;
        $wpdb->query(
            $wpdb->prepare(
                "UPDATE {$this->table_name} SET scheduled_action_id = %d, updated_at_gmt = %s
                 WHERE id = %d AND generation = %d AND status IN (%s, %s)",
                $action_id,
                gmdate( 'Y-m-d H:i:s' ),
                $id,
                $generation,
                self::STATUS_PENDING,
                self::STATUS_RETRY_WAIT
            )
        );
    }

    /**
     * Recover abandoned claims and return due rows needing wake-ups.
     *
     * @param int $limit Maximum rows.
     * @return array<int, array<string, mixed>>
     */
    public function due( int $limit = 100 ): array {
        if ( ! $this->available ) {
            return array();
        }
        global $wpdb;
        $now = gmdate( 'Y-m-d H:i:s' );
        $stale = gmdate( 'Y-m-d H:i:s', time() - self::CLAIM_TIMEOUT );
        $wpdb->query(
            $wpdb->prepare(
                "UPDATE {$this->table_name}
                 SET status = %s, next_attempt_gmt = %s, claim_token = NULL, claimed_at_gmt = NULL,
                     generation = generation + 1, scheduled_action_id = NULL,
                     last_error = %s, updated_at_gmt = %s
                 WHERE status = %s AND claimed_at_gmt < %s",
                self::STATUS_RETRY_WAIT,
                $now,
                'Recovered an interrupted delivery claim.',
                $now,
                self::STATUS_PROCESSING,
                $stale
            )
        );
        $rows = $wpdb->get_results(
            $wpdb->prepare(
                "SELECT * FROM {$this->table_name}
                 WHERE status IN (%s, %s) AND (next_attempt_gmt IS NULL OR next_attempt_gmt <= %s)
                 ORDER BY next_attempt_gmt ASC, id ASC LIMIT %d",
                self::STATUS_PENDING,
                self::STATUS_RETRY_WAIT,
                $now,
                max( 1, $limit )
            ),
            ARRAY_A
        );
        return is_array( $rows ) ? $rows : array();
    }

    /**
     * Retry or accelerate one inspectable row.
     *
     * @param int $id      Outbox row ID.
     * @param int $user_id Acting WordPress user ID.
     * @return array<string, mixed>|null
     */
    public function retry_now( int $id, int $user_id ): ?array {
        if ( ! $this->available ) {
            return null;
        }
        global $wpdb;
        $now = gmdate( 'Y-m-d H:i:s' );
        $updated = $wpdb->query(
            $wpdb->prepare(
                "UPDATE {$this->table_name}
                 SET status = %s, next_attempt_gmt = %s, generation = generation + 1,
                     scheduled_action_id = NULL, claim_token = NULL, claimed_at_gmt = NULL,
                     last_error = NULL, last_http_status = NULL, finished_at_gmt = NULL,
                     last_admin_user_id = %d, updated_at_gmt = %s
                 WHERE id = %d AND status IN (%s, %s, %s)",
                self::STATUS_PENDING,
                $now,
                $user_id,
                $now,
                $id,
                self::STATUS_PENDING,
                self::STATUS_RETRY_WAIT,
                self::STATUS_FAILED
            )
        );
        return 1 === $updated ? $this->get( $id ) : null;
    }

    /**
     * Preserve a failed legacy scheduler action for inspection and manual retry.
     *
     * @param int    $id    Outbox row ID.
     * @param string $error Import detail.
     */
    public function import_failed( int $id, string $error ): bool {
        if ( ! $this->available ) {
            return false;
        }
        global $wpdb;
        $now = gmdate( 'Y-m-d H:i:s' );
        $updated = $wpdb->query(
            $wpdb->prepare(
                "UPDATE {$this->table_name}
                 SET status = %s, next_attempt_gmt = NULL, last_error = %s,
                     finished_at_gmt = %s, updated_at_gmt = %s
                 WHERE id = %d AND status IN (%s, %s)",
                self::STATUS_FAILED,
                $this->bounded_error( $error ),
                $now,
                $now,
                $id,
                self::STATUS_PENDING,
                self::STATUS_RETRY_WAIT
            )
        );
        return 1 === $updated;
    }

    /**
     * Cancel one row that has not been claimed or delivered.
     *
     * @param int $id      Outbox row ID.
     * @param int $user_id Acting WordPress user ID.
     * @return array<string, mixed>|null Previous row when cancellation succeeds.
     */
    public function cancel( int $id, int $user_id ): ?array {
        if ( ! $this->available ) {
            return null;
        }
        global $wpdb;
        $row = $this->get( $id );
        if ( ! is_array( $row ) ) {
            return null;
        }
        $now = gmdate( 'Y-m-d H:i:s' );
        $updated = $wpdb->query(
            $wpdb->prepare(
                "UPDATE {$this->table_name}
                 SET status = %s, next_attempt_gmt = NULL, generation = generation + 1,
                     scheduled_action_id = NULL, claim_token = NULL, claimed_at_gmt = NULL,
                     finished_at_gmt = %s, last_admin_user_id = %d, updated_at_gmt = %s
                 WHERE id = %d AND generation = %d AND status IN (%s, %s, %s)",
                self::STATUS_CANCELLED,
                $now,
                $user_id,
                $now,
                $id,
                (int) $row['generation'],
                self::STATUS_PENDING,
                self::STATUS_RETRY_WAIT,
                self::STATUS_FAILED
            )
        );
        return 1 === $updated ? $row : null;
    }

    /**
     * List recent queue rows for merchant inspection.
     *
     * @param int    $limit  Maximum rows.
     * @param string $status Optional status filter.
     * @param int    $offset Result offset.
     * @return array<int, array<string, mixed>>
     */
    public function recent( int $limit = 50, string $status = '', int $offset = 0 ): array {
        if ( ! $this->available ) {
            return array();
        }
        global $wpdb;
        $statuses = $this->statuses();
        $limit = max( 1, min( 200, $limit ) );
        $offset = max( 0, $offset );
        if ( in_array( $status, $statuses, true ) ) {
            $query = $wpdb->prepare(
                "SELECT * FROM {$this->table_name} WHERE status = %s ORDER BY id DESC LIMIT %d OFFSET %d",
                $status,
                $limit,
                $offset
            );
        } else {
            $query = $wpdb->prepare(
                "SELECT * FROM {$this->table_name}
                 ORDER BY CASE status
                    WHEN %s THEN 0 WHEN %s THEN 1 WHEN %s THEN 2 WHEN %s THEN 3 ELSE 4 END,
                    id DESC LIMIT %d OFFSET %d",
                self::STATUS_FAILED,
                self::STATUS_RETRY_WAIT,
                self::STATUS_PENDING,
                self::STATUS_PROCESSING,
                $limit,
                $offset
            );
        }
        $rows = $wpdb->get_results( $query, ARRAY_A );
        return is_array( $rows ) ? $rows : array();
    }

    /**
     * Count rows for queue pagination.
     *
     * @param string $status Optional status filter.
     */
    public function total( string $status = '' ): int {
        if ( ! $this->available ) {
            return 0;
        }
        global $wpdb;
        if ( in_array( $status, $this->statuses(), true ) ) {
            return (int) $wpdb->get_var(
                $wpdb->prepare( "SELECT COUNT(*) FROM {$this->table_name} WHERE status = %s", $status )
            );
        }
        return (int) $wpdb->get_var( "SELECT COUNT(*) FROM {$this->table_name}" );
    }

    /**
     * Count rows by status for queue health.
     *
     * @return array<string, int>
     */
    public function status_counts(): array {
        if ( ! $this->available ) {
            return array();
        }
        global $wpdb;
        $rows = $wpdb->get_results(
            "SELECT status, COUNT(*) AS total FROM {$this->table_name} GROUP BY status",
            ARRAY_A
        );
        $counts = array();
        foreach ( is_array( $rows ) ? $rows : array() as $row ) {
            $counts[ (string) $row['status'] ] = (int) $row['total'];
        }
        return $counts;
    }

    /**
     * Return payload-free live queue health aggregates.
     *
     * @return array<string, int|bool>
     */
    public function health_snapshot(): array {
        $empty = array(
            'available'      => false,
            'pending'        => 0,
            'processing'     => 0,
            'failed'         => 0,
            'due'            => 0,
            'oldest_due_age' => 0,
            'stale_claims'   => 0,
            'last_cleanup'   => (int) get_option( self::OPTION_LAST_CLEANUP, 0 ),
        );
        if ( ! $this->available ) {
            return $empty;
        }
        global $wpdb;
        $now = gmdate( 'Y-m-d H:i:s' );
        $stale_cutoff = gmdate( 'Y-m-d H:i:s', time() - self::CLAIM_TIMEOUT );
        $row = $wpdb->get_row(
            $wpdb->prepare(
                "SELECT
                    SUM(CASE WHEN status IN (%s, %s) THEN 1 ELSE 0 END) AS pending,
                    SUM(CASE WHEN status = %s THEN 1 ELSE 0 END) AS processing,
                    SUM(CASE WHEN status = %s THEN 1 ELSE 0 END) AS failed,
                    SUM(CASE WHEN status IN (%s, %s) AND (next_attempt_gmt IS NULL OR next_attempt_gmt <= %s) THEN 1 ELSE 0 END) AS due_count,
                    MIN(CASE WHEN status IN (%s, %s) AND (next_attempt_gmt IS NULL OR next_attempt_gmt <= %s) THEN COALESCE(next_attempt_gmt, created_at_gmt) ELSE NULL END) AS oldest_due,
                    SUM(CASE WHEN status = %s AND (claimed_at_gmt IS NULL OR claimed_at_gmt < %s) THEN 1 ELSE 0 END) AS stale_claims
                 FROM {$this->table_name}",
                self::STATUS_PENDING,
                self::STATUS_RETRY_WAIT,
                self::STATUS_PROCESSING,
                self::STATUS_FAILED,
                self::STATUS_PENDING,
                self::STATUS_RETRY_WAIT,
                $now,
                self::STATUS_PENDING,
                self::STATUS_RETRY_WAIT,
                $now,
                self::STATUS_PROCESSING,
                $stale_cutoff
            ),
            ARRAY_A
        );
        if ( ! is_array( $row ) ) {
            return $empty;
        }
        $oldest_timestamp = ! empty( $row['oldest_due'] ) ? strtotime( (string) $row['oldest_due'] . ' UTC' ) : false;
        return array(
            'available'      => true,
            'pending'        => (int) $row['pending'],
            'processing'     => (int) $row['processing'],
            'failed'         => (int) $row['failed'],
            'due'            => (int) $row['due_count'],
            'oldest_due_age' => false === $oldest_timestamp ? 0 : max( 0, time() - $oldest_timestamp ),
            'stale_claims'   => (int) $row['stale_claims'],
            'last_cleanup'   => (int) get_option( self::OPTION_LAST_CLEANUP, 0 ),
        );
    }

    /**
     * Purge old terminal rows in bounded daily batches.
     */
    public function maybe_cleanup(): void {
        if ( ! $this->available ) {
            return;
        }
        $last_cleanup = (int) get_option( self::OPTION_LAST_CLEANUP, 0 );
        if ( $last_cleanup > time() - DAY_IN_SECONDS ) {
            return;
        }
        global $wpdb;
        $short_retention = gmdate( 'Y-m-d H:i:s', time() - 30 * DAY_IN_SECONDS );
        $long_retention = gmdate( 'Y-m-d H:i:s', time() - 90 * DAY_IN_SECONDS );
        $queries = array(
            $wpdb->prepare(
                "DELETE FROM {$this->table_name} WHERE status IN (%s, %s) AND finished_at_gmt < %s LIMIT 500",
                self::STATUS_DELIVERED,
                self::STATUS_SUPERSEDED,
                $short_retention
            ),
            $wpdb->prepare(
                "DELETE FROM {$this->table_name} WHERE status IN (%s, %s) AND finished_at_gmt < %s LIMIT 500",
                self::STATUS_FAILED,
                self::STATUS_CANCELLED,
                $long_retention
            ),
        );
        $succeeded = true;
        foreach ( $queries as $query ) {
            for ( $batch = 0; $batch < 3; ++$batch ) {
                $deleted = $wpdb->query( $query );
                if ( false === $deleted ) {
                    $succeeded = false;
                    break 2;
                }
                if ( $deleted < 500 ) {
                    break;
                }
            }
        }
        if ( $succeeded ) {
            update_option( self::OPTION_LAST_CLEANUP, time(), false );
            if ( class_exists( 'PKC_Observability' ) ) {
                PKC_Observability::record( 'cleanup', 'success' );
            }
        } elseif ( class_exists( 'PKC_Observability' ) ) {
            PKC_Observability::record( 'cleanup', 'failure' );
        }
    }

    /**
     * Bound stored remote errors without exposing unbounded response bodies.
     *
     * @param string $error Error text.
     */
    private function bounded_error( string $error ): string {
        $error = wp_strip_all_tags( $error );
        return function_exists( 'mb_substr' ) ? mb_substr( $error, 0, 2000 ) : substr( $error, 0, 2000 );
    }

    /**
     * Return every persisted state accepted by admin filters.
     *
     * @return array<int, string>
     */
    private function statuses(): array {
        return array(
            self::STATUS_PENDING,
            self::STATUS_RETRY_WAIT,
            self::STATUS_PROCESSING,
            self::STATUS_DELIVERED,
            self::STATUS_FAILED,
            self::STATUS_CANCELLED,
            self::STATUS_SUPERSEDED,
        );
    }
}
