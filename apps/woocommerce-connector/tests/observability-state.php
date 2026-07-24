<?php
/**
 * Standalone observability reducer and health-classification tests.
 */

define( 'ABSPATH', __DIR__ . '/' );
define( 'DAY_IN_SECONDS', 86400 );
define( 'MINUTE_IN_SECONDS', 60 );
define( 'PKC_VERSION', 'test-version' );
define( 'PKC_DB_VERSION', 'test-db-version' );
$pkc_test_option = null;
function add_filter(): void {}
function add_action(): void {}
function as_next_scheduled_action() { return false; }
function wp_next_scheduled( string $hook ) { return 'pkc_sweep_outbox' === $hook ? 100 : 200; }
function get_option() { global $pkc_test_option; return $pkc_test_option; }
function wp_json_encode( $value ) { return json_encode( $value ); }
function __( string $value ): string { return $value; }
class PKC_Outbox {
    public function health_snapshot(): array {
        return array( 'available' => true, 'pending' => 0, 'processing' => 0, 'failed' => 0, 'oldest_due_age' => 0, 'stale_claims' => 0 );
    }
}
require_once dirname( __DIR__ ) . '/includes/class-pkc-observability.php';

function pkc_assert( bool $condition, string $message ): void {
    if ( ! $condition ) {
        fwrite( STDERR, $message . PHP_EOL );
        exit( 1 );
    }
}

$now = strtotime( '2026-07-30T12:00:00Z' );
$state = PKC_Observability::reduce_state( null, 'delivery', 'success', $now );
pkc_assert( 1 === $state['days']['2026-07-30']['delivery:success'], 'Initial counter was not recorded.' );

$state = PKC_Observability::reduce_state( $state, 'delivery', 'success', $now, 2 );
pkc_assert( 3 === $state['days']['2026-07-30']['delivery:success'], 'Counter increment was not accumulated.' );

$state['days']['2026-07-01'] = array( 'delivery:failure' => 10 );
$state = PKC_Observability::reduce_state( $state, 'delivery', 'retry', $now );
pkc_assert( ! isset( $state['days']['2026-07-01'] ), 'Expired daily bucket was not pruned.' );

$unchanged = PKC_Observability::reduce_state( $state, 'unknown_metric', 'success', $now );
pkc_assert( $state === $unchanged, 'Unknown metric was accepted.' );

$malformed = PKC_Observability::reduce_state( array( 'version' => 999, 'days' => array( 'secret' => 'value' ) ), 'outbox', 'enqueued', $now );
pkc_assert( ! str_contains( serialize( $malformed ), 'secret' ), 'Malformed state data survived normalization.' );
pkc_assert( 1 === $malformed['days']['2026-07-30']['outbox:enqueued'], 'Malformed state did not recover.' );

$healthy = PKC_Observability::classify_queue_health( array( 'available' => true, 'failed' => 0, 'stale_claims' => 0, 'oldest_due_age' => 0 ) );
pkc_assert( 'good' === $healthy['status'], 'Healthy queue was not classified as good.' );
$failed = PKC_Observability::classify_queue_health( array( 'available' => true, 'failed' => 1, 'stale_claims' => 0, 'oldest_due_age' => 0 ) );
pkc_assert( 'recommended' === $failed['status'], 'Failed queue rows did not require attention.' );
$stale = PKC_Observability::classify_queue_health( array( 'available' => true, 'failed' => 0, 'stale_claims' => 1, 'oldest_due_age' => 0 ) );
pkc_assert( 'critical' === $stale['status'], 'Stale claims were not classified as critical.' );

$observability = new PKC_Observability( new PKC_Outbox() );
$scheduler = $observability->scheduler_snapshot();
pkc_assert( 'wp_cron' === $scheduler['backend'], 'WP-Cron fallback was not detected.' );
pkc_assert( 100 === $scheduler['next_sweep'] && 200 === $scheduler['next_reconciliation'], 'WP-Cron next runs were not reported.' );

$pkc_test_option = array( 'version' => 1, 'days' => array( '2026-07-30' => array( 'secret-payload' => 'customer-reference' ) ), 'last' => array() );
$debug = $observability->register_debug_information( array() );
$debug_text = serialize( $debug );
pkc_assert( ! str_contains( $debug_text, 'customer-reference' ), 'Unallowlisted state leaked into debug information.' );
pkc_assert( ! str_contains( $debug_text, 'pkc_signing_secret' ), 'Credential option name leaked into debug information.' );

exit( 0 );
