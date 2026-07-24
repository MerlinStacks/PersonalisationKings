<?php
/**
 * Core connector bootstrap.
 *
 * @package PersonaliseKingsConnector
 */

defined( 'ABSPATH' ) || exit;

require_once PKC_PATH . 'includes/class-pkc-outbox.php';
require_once PKC_PATH . 'includes/class-pkc-observability.php';
require_once PKC_PATH . 'includes/class-pkc-settings.php';
require_once PKC_PATH . 'includes/class-pkc-frontend.php';
require_once PKC_PATH . 'includes/class-pkc-order-sync.php';

/**
 * PersonaliseKings connector singleton.
 */
class Personalise_Kings_Connector {
    private static ?Personalise_Kings_Connector $instance = null;
    private PKC_Frontend $frontend;

    /**
     * Get plugin instance.
     */
    public static function instance(): self {
        if ( null === self::$instance ) {
            self::$instance = new self();
        }

        return self::$instance;
    }

    /**
     * Constructor.
     */
    private function __construct() {
        $outbox = new PKC_Outbox();
        new PKC_Observability( $outbox );
        new PKC_Settings( $outbox );
        $this->frontend = new PKC_Frontend();
        new PKC_Order_Sync( $outbox );
    }

    /**
     * Render the customiser from a theme template.
     */
    public function render_customiser(): void {
        $this->frontend->render_embed();
    }
}
