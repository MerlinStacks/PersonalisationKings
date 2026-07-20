<?php
/**
 * Plugin Name: PersonaliseKings Connector
 * Description: Thin WooCommerce connector for the PersonaliseKings hosted customiser and order sync.
 * Version:     0.7.0
 * Requires at least: 6.4
 * Requires PHP: 8.1
 * Author:      PersonaliseKings
 * License:     GPL-2.0-or-later
 * Text Domain: personalise-kings-connector
 * Requires Plugins: woocommerce
 * WC requires at least: 8.0
 *
 * @package PersonaliseKingsConnector
 */

defined( 'ABSPATH' ) || exit;

define( 'PKC_VERSION', '0.7.0' );
define( 'PKC_DB_VERSION', '1.3.0' );
define( 'PKC_PATH', plugin_dir_path( __FILE__ ) );
define( 'PKC_URL', plugin_dir_url( __FILE__ ) );

register_activation_hook(
    __FILE__,
    static function (): void {
        require_once PKC_PATH . 'includes/class-pkc-outbox.php';
        PKC_Outbox::install();
    }
);

register_deactivation_hook(
    __FILE__,
    static function (): void {
        wp_clear_scheduled_hook( 'pkc_reconcile_modified_orders' );
        wp_clear_scheduled_hook( 'pkc_sweep_outbox' );
        if ( function_exists( 'as_unschedule_all_actions' ) ) {
            as_unschedule_all_actions( 'pkc_reconcile_modified_orders', array(), 'personalise-kings-connector' );
            as_unschedule_all_actions( 'pkc_sweep_outbox', array(), 'personalise-kings-connector' );
        }
    }
);

add_action(
    'before_woocommerce_init',
    static function (): void {
        if ( class_exists( \Automattic\WooCommerce\Utilities\FeaturesUtil::class ) ) {
            \Automattic\WooCommerce\Utilities\FeaturesUtil::declare_compatibility( 'custom_order_tables', __FILE__, true );
        }
    }
);

add_action(
    'plugins_loaded',
    static function (): void {
        if ( ! class_exists( 'WooCommerce' ) ) {
            add_action(
                'admin_notices',
                static function (): void {
                    echo '<div class="notice notice-warning"><p>' . esc_html__( 'PersonaliseKings Connector requires WooCommerce to be active.', 'personalise-kings-connector' ) . '</p></div>';
                }
            );
            return;
        }

        require_once PKC_PATH . 'includes/class-personalise-kings-connector.php';
        Personalise_Kings_Connector::instance();
    }
);
