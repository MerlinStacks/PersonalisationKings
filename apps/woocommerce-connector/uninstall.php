<?php
/**
 * Remove privacy-bounded diagnostic counters on uninstall.
 *
 * Durable delivery, mapping, and credential data require a separate explicit
 * merchant data-deletion decision and are intentionally not removed here.
 *
 * @package PersonaliseKingsConnector
 */

defined( 'WP_UNINSTALL_PLUGIN' ) || exit;

delete_option( 'pkc_observability_v1' );
delete_option( 'pkc_outbox_schema_checked_at' );
