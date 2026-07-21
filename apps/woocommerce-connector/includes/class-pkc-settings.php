<?php
/**
 * Connector settings.
 *
 * @package PersonaliseKingsConnector
 */

defined( 'ABSPATH' ) || exit;

/**
 * Registers minimal connector settings.
 */
class PKC_Settings {
    public const OPTION_WEBAPP_URL = 'pkc_webapp_url';
    public const OPTION_API_URL = 'pkc_api_url';
    public const OPTION_STORE_ID = 'pkc_store_id';
    public const OPTION_KEY_ID = 'pkc_key_id';
    public const OPTION_SECRET = 'pkc_signing_secret';
    public const OPTION_CREDENTIAL = 'pkc_signing_credential';
    public const OPTION_LAST_SUCCESS = 'pkc_last_successful_delivery';
    public const OPTION_LAST_FAILURE = 'pkc_last_failed_delivery';
    public const OPTION_LAST_ERROR = 'pkc_last_delivery_error';
    public const OPTION_RECONCILIATION_WATERMARK = 'pkc_reconciliation_watermark';
    public const OPTION_LAST_RECONCILIATION = 'pkc_last_reconciliation';
    public const OPTION_LAST_RECONCILIATION_COUNT = 'pkc_last_reconciliation_count';
    public const OPTION_RECONCILIATION_ERROR = 'pkc_reconciliation_error';
    public const OPTION_PLACEMENT = 'pkc_customiser_placement';

    private PKC_Outbox $outbox;

    /**
     * Constructor.
     */
    public function __construct( PKC_Outbox $outbox ) {
        $this->outbox = $outbox;
        add_action( 'admin_menu', array( $this, 'register_page' ) );
        add_action( 'admin_init', array( $this, 'register_settings' ) );
    }

    /**
     * Register settings page.
     */
    public function register_page(): void {
        add_submenu_page(
            'woocommerce',
            __( 'PersonaliseKings', 'personalise-kings-connector' ),
            __( 'PersonaliseKings', 'personalise-kings-connector' ),
            'manage_woocommerce',
            'personalise-kings-connector',
            array( $this, 'render_page' )
        );
    }

    /**
     * Register options.
     */
    public function register_settings(): void {
        register_setting( 'pkc_settings', self::OPTION_WEBAPP_URL, array( 'sanitize_callback' => 'esc_url_raw' ) );
        register_setting( 'pkc_settings', self::OPTION_API_URL, array( 'sanitize_callback' => 'esc_url_raw' ) );
        register_setting( 'pkc_settings', self::OPTION_STORE_ID, array( 'sanitize_callback' => 'sanitize_text_field' ) );
        register_setting( 'pkc_settings', self::OPTION_CREDENTIAL, array( 'sanitize_callback' => array( $this, 'sanitize_signing_credential' ) ) );
        register_setting(
            'pkc_settings',
            self::OPTION_PLACEMENT,
            array(
                'default'           => 'classic',
                'sanitize_callback' => array( $this, 'sanitize_placement' ),
            )
        );
    }

    /**
     * Render settings page.
     */
    public function render_page(): void {
        $watermark = (int) get_option( self::OPTION_RECONCILIATION_WATERMARK, 0 );
        $watermark_display = $watermark > 0 ? gmdate( 'c', $watermark ) : __( 'Not started', 'personalise-kings-connector' );
        $outbox_status = isset( $_GET['pkc_outbox_status'] ) ? sanitize_key( wp_unslash( $_GET['pkc_outbox_status'] ) ) : '';
        $outbox_page = isset( $_GET['pkc_outbox_page'] ) ? max( 1, absint( wp_unslash( $_GET['pkc_outbox_page'] ) ) ) : 1;
        $outbox_total = $this->outbox->total( $outbox_status );
        $outbox_pages = max( 1, (int) ceil( $outbox_total / 50 ) );
        $outbox_page = min( $outbox_page, $outbox_pages );
        $outbox_rows = $this->outbox->recent( 50, $outbox_status, ( $outbox_page - 1 ) * 50 );
        $outbox_counts = $this->outbox->status_counts();
        $this->render_outbox_notice();
        ?>
        <div class="wrap">
            <h1><?php echo esc_html__( 'PersonaliseKings Connector', 'personalise-kings-connector' ); ?></h1>
            <?php if ( ! $this->outbox->is_available() ) : ?>
                <div class="notice notice-error inline"><p><?php echo esc_html__( 'The connector outbox schema is unavailable. Order events will not be accepted until the database migration succeeds.', 'personalise-kings-connector' ); ?></p></div>
            <?php endif; ?>
            <form method="post" action="options.php">
                <?php settings_fields( 'pkc_settings' ); ?>
                <table class="form-table" role="presentation">
                    <?php $this->render_input( self::OPTION_WEBAPP_URL, __( 'Customiser webapp URL', 'personalise-kings-connector' ), 'http://localhost:3001' ); ?>
                    <?php $this->render_input( self::OPTION_API_URL, __( 'Connector API URL', 'personalise-kings-connector' ), 'http://localhost:3002' ); ?>
                    <?php $this->render_input( self::OPTION_STORE_ID, __( 'PersonaliseKings store ID', 'personalise-kings-connector' ), '' ); ?>
                    <?php $credential = self::signing_credential(); ?>
                    <tr><th scope="row"><?php echo esc_html__( 'Active signing key', 'personalise-kings-connector' ); ?></th><td><code><?php echo esc_html( $credential['key_id'] ?? __( 'Not configured', 'personalise-kings-connector' ) ); ?></code></td></tr>
                    <tr><th scope="row"><label for="pkc_replacement_key_id"><?php echo esc_html__( 'Replacement signing key ID', 'personalise-kings-connector' ); ?></label></th><td><input class="regular-text" id="pkc_replacement_key_id" name="<?php echo esc_attr( self::OPTION_CREDENTIAL ); ?>[key_id]" value="" autocomplete="off" /></td></tr>
                    <tr><th scope="row"><label for="pkc_replacement_secret"><?php echo esc_html__( 'Replacement signing secret', 'personalise-kings-connector' ); ?></label></th><td><input class="regular-text" type="password" id="pkc_replacement_secret" name="<?php echo esc_attr( self::OPTION_CREDENTIAL ); ?>[secret]" value="" autocomplete="new-password" /><p class="description"><?php echo esc_html__( 'Enter the key ID and secret together. Leaving either blank keeps the current credential.', 'personalise-kings-connector' ); ?></p></td></tr>
                    <tr>
                        <th scope="row"><label for="<?php echo esc_attr( self::OPTION_PLACEMENT ); ?>"><?php echo esc_html__( 'Customiser placement', 'personalise-kings-connector' ); ?></label></th>
                        <td>
                            <select id="<?php echo esc_attr( self::OPTION_PLACEMENT ); ?>" name="<?php echo esc_attr( self::OPTION_PLACEMENT ); ?>">
                                <?php foreach ( $this->placement_options() as $value => $label ) : ?>
                                    <option value="<?php echo esc_attr( $value ); ?>" <?php selected( get_option( self::OPTION_PLACEMENT, 'classic' ), $value ); ?>><?php echo esc_html( $label ); ?></option>
                                <?php endforeach; ?>
                            </select>
                            <p class="description"><?php echo wp_kses_post( __( 'Block/manual mode disables automatic output. Add the <strong>PersonaliseKings Customiser</strong> block, use <code>[personalise_kings_customiser]</code>, or call <code>personalise_kings_render_customiser()</code> in a product template.', 'personalise-kings-connector' ) ); ?></p>
                        </td>
                    </tr>
                </table>
                <?php submit_button(); ?>
            </form>
            <h2><?php echo esc_html__( 'Connector Health', 'personalise-kings-connector' ); ?></h2>
            <table class="widefat striped" style="max-width: 760px;">
                <tbody>
                    <tr><th><?php echo esc_html__( 'Last successful delivery', 'personalise-kings-connector' ); ?></th><td><?php echo esc_html( (string) get_option( self::OPTION_LAST_SUCCESS, __( 'Never', 'personalise-kings-connector' ) ) ); ?></td></tr>
                    <tr><th><?php echo esc_html__( 'Last failed delivery', 'personalise-kings-connector' ); ?></th><td><?php echo esc_html( (string) get_option( self::OPTION_LAST_FAILURE, __( 'Never', 'personalise-kings-connector' ) ) ); ?></td></tr>
                    <tr><th><?php echo esc_html__( 'Last error', 'personalise-kings-connector' ); ?></th><td><?php echo esc_html( (string) get_option( self::OPTION_LAST_ERROR, __( 'None', 'personalise-kings-connector' ) ) ); ?></td></tr>
                    <tr><th><?php echo esc_html__( 'Last reconciliation', 'personalise-kings-connector' ); ?></th><td><?php echo esc_html( (string) get_option( self::OPTION_LAST_RECONCILIATION, __( 'Never', 'personalise-kings-connector' ) ) ); ?></td></tr>
                    <tr><th><?php echo esc_html__( 'Orders reconciled', 'personalise-kings-connector' ); ?></th><td><?php echo esc_html( (string) get_option( self::OPTION_LAST_RECONCILIATION_COUNT, 0 ) ); ?></td></tr>
                    <tr><th><?php echo esc_html__( 'Reconciliation watermark', 'personalise-kings-connector' ); ?></th><td><?php echo esc_html( $watermark_display ); ?></td></tr>
                    <tr><th><?php echo esc_html__( 'Reconciliation error', 'personalise-kings-connector' ); ?></th><td><?php echo esc_html( (string) get_option( self::OPTION_RECONCILIATION_ERROR, __( 'None', 'personalise-kings-connector' ) ) ); ?></td></tr>
                </tbody>
            </table>
            <h2><?php echo esc_html__( 'Delivery Queue', 'personalise-kings-connector' ); ?></h2>
            <p><?php echo esc_html__( 'The outbox row is the durable event. Action Scheduler and WP-Cron are replaceable wake-ups, so a missing scheduler action cannot lose an order update.', 'personalise-kings-connector' ); ?></p>
            <p>
                <strong><?php echo esc_html__( 'Pending', 'personalise-kings-connector' ); ?>:</strong> <?php echo esc_html( (string) ( ( $outbox_counts[ PKC_Outbox::STATUS_PENDING ] ?? 0 ) + ( $outbox_counts[ PKC_Outbox::STATUS_RETRY_WAIT ] ?? 0 ) ) ); ?>
                &nbsp; <strong><?php echo esc_html__( 'Processing', 'personalise-kings-connector' ); ?>:</strong> <?php echo esc_html( (string) ( $outbox_counts[ PKC_Outbox::STATUS_PROCESSING ] ?? 0 ) ); ?>
                &nbsp; <strong><?php echo esc_html__( 'Failed', 'personalise-kings-connector' ); ?>:</strong> <?php echo esc_html( (string) ( $outbox_counts[ PKC_Outbox::STATUS_FAILED ] ?? 0 ) ); ?>
            </p>
            <form method="get" action="<?php echo esc_url( admin_url( 'admin.php' ) ); ?>" style="margin:0 0 12px;">
                <input type="hidden" name="page" value="personalise-kings-connector" />
                <label for="pkc_outbox_status"><?php echo esc_html__( 'Queue status', 'personalise-kings-connector' ); ?></label>
                <select id="pkc_outbox_status" name="pkc_outbox_status">
                    <option value=""><?php echo esc_html__( 'Active and failed first', 'personalise-kings-connector' ); ?></option>
                    <?php foreach ( array( PKC_Outbox::STATUS_FAILED, PKC_Outbox::STATUS_RETRY_WAIT, PKC_Outbox::STATUS_PENDING, PKC_Outbox::STATUS_PROCESSING, PKC_Outbox::STATUS_DELIVERED, PKC_Outbox::STATUS_CANCELLED, PKC_Outbox::STATUS_SUPERSEDED ) as $status_filter ) : ?>
                        <option value="<?php echo esc_attr( $status_filter ); ?>" <?php selected( $outbox_status, $status_filter ); ?>><?php echo esc_html( $status_filter ); ?></option>
                    <?php endforeach; ?>
                </select>
                <?php submit_button( __( 'Filter', 'personalise-kings-connector' ), 'secondary', '', false ); ?>
            </form>
            <table class="widefat striped">
                <thead>
                    <tr>
                        <th><?php echo esc_html__( 'Order', 'personalise-kings-connector' ); ?></th>
                        <th><?php echo esc_html__( 'Event', 'personalise-kings-connector' ); ?></th>
                        <th><?php echo esc_html__( 'Status', 'personalise-kings-connector' ); ?></th>
                        <th><?php echo esc_html__( 'Attempts', 'personalise-kings-connector' ); ?></th>
                        <th><?php echo esc_html__( 'Next attempt (UTC)', 'personalise-kings-connector' ); ?></th>
                        <th><?php echo esc_html__( 'Last result', 'personalise-kings-connector' ); ?></th>
                        <th><?php echo esc_html__( 'Updated (UTC)', 'personalise-kings-connector' ); ?></th>
                        <th><?php echo esc_html__( 'Actions', 'personalise-kings-connector' ); ?></th>
                    </tr>
                </thead>
                <tbody>
                    <?php if ( empty( $outbox_rows ) ) : ?>
                        <tr><td colspan="8"><?php echo esc_html__( 'No connector events have been queued yet.', 'personalise-kings-connector' ); ?></td></tr>
                    <?php else : ?>
                        <?php foreach ( $outbox_rows as $row ) : ?>
                            <?php
                            $order = wc_get_order( (int) $row['order_id'] );
                            $status = (string) $row['status'];
                            $can_control = in_array( $status, array( PKC_Outbox::STATUS_PENDING, PKC_Outbox::STATUS_RETRY_WAIT, PKC_Outbox::STATUS_FAILED ), true );
                            $result = ! empty( $row['last_http_status'] ) ? 'HTTP ' . (int) $row['last_http_status'] : '';
                            if ( ! empty( $row['last_error'] ) ) {
                                $result .= ( '' === $result ? '' : ': ' ) . wp_html_excerpt( (string) $row['last_error'], 120, '&hellip;' );
                            }
                            ?>
                            <tr>
                                <td>
                                    <?php if ( $order instanceof WC_Order ) : ?>
                                        <a href="<?php echo esc_url( $order->get_edit_order_url() ); ?>">#<?php echo esc_html( $order->get_order_number() ); ?></a>
                                    <?php else : ?>
                                        #<?php echo esc_html( (string) $row['order_id'] ); ?>
                                    <?php endif; ?>
                                </td>
                                <td><code><?php echo esc_html( (string) $row['event_type'] ); ?></code><br /><small title="<?php echo esc_attr( (string) $row['event_key'] ); ?>"><?php echo esc_html( wp_html_excerpt( (string) $row['event_key'], 44, '&hellip;' ) ); ?></small></td>
                                <td><code><?php echo esc_html( $status ); ?></code></td>
                                <td><?php echo esc_html( (string) $row['attempt_count'] ); ?></td>
                                <td><?php echo esc_html( ! empty( $row['next_attempt_gmt'] ) ? (string) $row['next_attempt_gmt'] : '-' ); ?></td>
                                <td title="<?php echo esc_attr( (string) ( $row['last_error'] ?? '' ) ); ?>"><?php echo wp_kses_post( '' === $result ? '&ndash;' : esc_html( $result ) ); ?></td>
                                <td><?php echo esc_html( (string) $row['updated_at_gmt'] ); ?></td>
                                <td>
                                    <?php if ( $can_control ) : ?>
                                        <?php $this->render_outbox_action( (int) $row['id'], 'pkc_retry_outbox', PKC_Outbox::STATUS_PENDING === $status ? __( 'Run now', 'personalise-kings-connector' ) : __( 'Retry now', 'personalise-kings-connector' ) ); ?>
                                        <?php $this->render_outbox_action( (int) $row['id'], 'pkc_cancel_outbox', __( 'Cancel', 'personalise-kings-connector' ), true ); ?>
                                    <?php else : ?>
                                        &ndash;
                                    <?php endif; ?>
                                </td>
                            </tr>
                        <?php endforeach; ?>
                    <?php endif; ?>
                </tbody>
            </table>
            <?php if ( $outbox_pages > 1 ) : ?>
                <p class="tablenav-pages">
                    <?php if ( $outbox_page > 1 ) : ?>
                        <a class="button" href="<?php echo esc_url( $this->outbox_page_url( $outbox_page - 1, $outbox_status ) ); ?>"><?php echo esc_html__( 'Previous', 'personalise-kings-connector' ); ?></a>
                    <?php endif; ?>
                    <span><?php echo esc_html( sprintf( __( 'Page %1$d of %2$d', 'personalise-kings-connector' ), $outbox_page, $outbox_pages ) ); ?></span>
                    <?php if ( $outbox_page < $outbox_pages ) : ?>
                        <a class="button" href="<?php echo esc_url( $this->outbox_page_url( $outbox_page + 1, $outbox_status ) ); ?>"><?php echo esc_html__( 'Next', 'personalise-kings-connector' ); ?></a>
                    <?php endif; ?>
                </p>
            <?php endif; ?>
        </div>
        <?php
    }

    /**
     * Render an input row.
     *
     * @param string $option Option name.
     * @param string $label  Field label.
     * @param string $placeholder Placeholder.
     */
    private function render_input( string $option, string $label, string $placeholder ): void {
        ?>
        <tr>
            <th scope="row"><label for="<?php echo esc_attr( $option ); ?>"><?php echo esc_html( $label ); ?></label></th>
            <td><input class="regular-text" id="<?php echo esc_attr( $option ); ?>" name="<?php echo esc_attr( $option ); ?>" value="<?php echo esc_attr( (string) get_option( $option, '' ) ); ?>" placeholder="<?php echo esc_attr( $placeholder ); ?>" /></td>
        </tr>
        <?php
    }

    /**
     * Return one atomic signing credential snapshot, migrating a complete legacy pair once.
     *
     * @return array{key_id:string,secret:string}|null
     */
    public static function signing_credential(): ?array {
        $credential = get_option( self::OPTION_CREDENTIAL, null );
        if ( is_array( $credential ) && ! empty( $credential['key_id'] ) && ! empty( $credential['secret'] ) ) {
            return array( 'key_id' => (string) $credential['key_id'], 'secret' => (string) $credential['secret'] );
        }
        $key_id = (string) get_option( self::OPTION_KEY_ID, '' );
        $secret = (string) get_option( self::OPTION_SECRET, '' );
        if ( '' === $key_id || '' === $secret ) return null;
        $credential = array( 'key_id' => $key_id, 'secret' => $secret );
        add_option( self::OPTION_CREDENTIAL, $credential, '', false );
        return $credential;
    }

    /**
     * Replace the credential only when both submitted values are present.
     *
     * @param mixed $value Submitted credential fields.
     * @return array{key_id:string,secret:string}|null
     */
    public function sanitize_signing_credential( $value ): ?array {
        $current = self::signing_credential();
        if ( ! is_array( $value ) ) return $current;
        $key_id = isset( $value['key_id'] ) ? sanitize_text_field( (string) $value['key_id'] ) : '';
        $secret = isset( $value['secret'] ) ? sanitize_text_field( (string) $value['secret'] ) : '';
        if ( '' === $key_id || '' === $secret ) return $current;
        return array( 'key_id' => $key_id, 'secret' => $secret );
    }

    /**
     * Restrict customiser placement to supported adapters.
     *
     * @param mixed $placement Submitted option value.
     */
    public function sanitize_placement( $placement ): string {
        $placement = sanitize_key( (string) $placement );
        return array_key_exists( $placement, $this->placement_options() ) ? $placement : 'classic';
    }

    /**
     * Return selectable placement adapters.
     *
     * @return array<string, string>
     */
    private function placement_options(): array {
        return array(
            'classic' => __( 'Before add to cart (classic)', 'personalise-kings-connector' ),
            'gallery' => __( 'Replace product gallery', 'personalise-kings-connector' ),
            'modal'   => __( 'Open in modal', 'personalise-kings-connector' ),
            'manual'  => __( 'Block, shortcode, or theme code', 'personalise-kings-connector' ),
        );
    }

    /**
     * Render a nonce-protected outbox control.
     *
     * @param int    $outbox_id Outbox row ID.
     * @param string $action    Admin-post action.
     * @param string $label     Button label.
     * @param bool   $dangerous Whether confirmation is required.
     */
    private function render_outbox_action( int $outbox_id, string $action, string $label, bool $dangerous = false ): void {
        ?>
        <form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" style="display:inline-block;margin:0 4px 4px 0;">
            <input type="hidden" name="action" value="<?php echo esc_attr( $action ); ?>" />
            <input type="hidden" name="outbox_id" value="<?php echo esc_attr( (string) $outbox_id ); ?>" />
            <?php wp_nonce_field( 'pkc_outbox_' . $outbox_id ); ?>
            <button type="submit" class="button button-small"<?php echo $dangerous ? ' onclick="return confirm(\'' . esc_js( __( 'Cancel this undelivered event? Cancelling a refund or cancellation event can leave production work active.', 'personalise-kings-connector' ) ) . '\');"' : ''; ?>><?php echo esc_html( $label ); ?></button>
        </form>
        <?php
    }

    /**
     * Render the result of an outbox admin action.
     */
    private function render_outbox_notice(): void {
        $notice = isset( $_GET['pkc_outbox_notice'] ) ? sanitize_key( wp_unslash( $_GET['pkc_outbox_notice'] ) ) : '';
        $messages = array(
            'retried'         => array( 'success', __( 'The event has been queued to run now.', 'personalise-kings-connector' ) ),
            'retry_persisted' => array( 'warning', __( 'The retry is durable, but its scheduler wake-up will be repaired by the next sweep.', 'personalise-kings-connector' ) ),
            'retry_failed'    => array( 'error', __( 'The event could not be retried, usually because it is already processing or terminal.', 'personalise-kings-connector' ) ),
            'cancelled'       => array( 'success', __( 'The undelivered event has been cancelled.', 'personalise-kings-connector' ) ),
            'cancel_failed'   => array( 'error', __( 'The event could not be cancelled because processing already started or its state changed.', 'personalise-kings-connector' ) ),
        );
        if ( ! isset( $messages[ $notice ] ) ) {
            return;
        }
        echo '<div class="notice notice-' . esc_attr( $messages[ $notice ][0] ) . ' is-dismissible"><p>' . esc_html( $messages[ $notice ][1] ) . '</p></div>';
    }

    /**
     * Build a queue pagination URL.
     *
     * @param int    $page   Page number.
     * @param string $status Optional status filter.
     */
    private function outbox_page_url( int $page, string $status ): string {
        return add_query_arg(
            array_filter(
                array(
                    'page'              => 'personalise-kings-connector',
                    'pkc_outbox_page'   => $page,
                    'pkc_outbox_status' => $status,
                )
            ),
            admin_url( 'admin.php' )
        );
    }
}
