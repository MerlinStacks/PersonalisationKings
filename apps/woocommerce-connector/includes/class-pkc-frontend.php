<?php
/**
 * Product-page customiser embed.
 *
 * @package PersonaliseKingsConnector
 */

defined( 'ABSPATH' ) || exit;

/**
 * Adds a hosted customiser placeholder to product pages.
 */
class PKC_Frontend {
    /**
     * Constructor.
     */
    public function __construct() {
        add_action( 'wp_enqueue_scripts', array( $this, 'enqueue_assets' ) );
        add_action( 'woocommerce_before_add_to_cart_button', array( $this, 'render_embed' ), 15 );
        add_filter( 'woocommerce_add_to_cart_validation', array( $this, 'validate_add_to_cart' ), 10, 5 );
        add_filter( 'woocommerce_add_cart_item_data', array( $this, 'add_cart_item_data' ), 10, 4 );
        add_filter( 'woocommerce_get_item_data', array( $this, 'display_cart_item_data' ), 10, 2 );
        add_filter( 'woocommerce_cart_item_name', array( $this, 'add_cart_edit_link' ), 10, 3 );
        add_action( 'woocommerce_before_calculate_totals', array( $this, 'apply_price_modifiers' ), 20 );
        add_action( 'woocommerce_checkout_create_order_line_item', array( $this, 'add_order_item_data' ), 10, 4 );
        add_action( 'wp_ajax_pkc_refresh_embed_token', array( $this, 'refresh_embed_token' ) );
        add_action( 'wp_ajax_nopriv_pkc_refresh_embed_token', array( $this, 'refresh_embed_token' ) );
        add_action( 'wp_ajax_pkc_update_cart_customisation', array( $this, 'update_cart_customisation' ) );
        add_action( 'wp_ajax_nopriv_pkc_update_cart_customisation', array( $this, 'update_cart_customisation' ) );
    }

    /**
     * Enqueue frontend script.
     */
    public function enqueue_assets(): void {
        if ( ! is_product() ) {
            return;
        }

        wp_enqueue_script( 'pkc-frontend', PKC_URL . 'assets/frontend.js', array(), PKC_VERSION, true );
    }

    /**
     * Render iframe container.
     */
    public function render_embed(): void {
        global $product;

        if ( ! $product instanceof WC_Product ) {
            return;
        }

        $webapp_url = rtrim( (string) get_option( PKC_Settings::OPTION_WEBAPP_URL, '' ), '/' );
        $api_url = rtrim( (string) get_option( PKC_Settings::OPTION_API_URL, '' ), '/' );
        $store_id = (string) get_option( PKC_Settings::OPTION_STORE_ID, '' );

        if ( '' === $webapp_url || '' === $api_url || '' === $store_id ) {
            return;
        }

        $correlation_id  = wp_generate_uuid4();
        $parent_origin   = $this->url_origin( home_url() );
        $customiser_origin = $this->url_origin( $webapp_url );
        if ( $product->is_type( 'variable' ) && ! $this->has_product_mapping( $api_url, $store_id, (string) $product->get_id(), $correlation_id ) ) {
            return;
        }
        $edit_context = $this->get_cart_edit_context( (string) $product->get_id() );
        $initial_variant_id = is_array( $edit_context ) ? (string) $edit_context['variation_id'] : '';
        $edit_reference = is_array( $edit_context ) ? (string) $edit_context['reference'] : '';
        $edit_cart_key = is_array( $edit_context ) ? (string) $edit_context['cart_item_key'] : '';
        $embed_config = ( ! $product->is_type( 'variable' ) || '' !== $initial_variant_id )
            ? $this->request_embed_token( $api_url, $store_id, $parent_origin, (string) $product->get_id(), $initial_variant_id, $correlation_id )
            : null;
        $embed_token = is_array( $embed_config ) ? (string) $embed_config['embed_token'] : '';
        $price_modifier_minor = is_array( $embed_config ) ? (int) $embed_config['price_modifier_minor'] : 0;
        if ( ( ! $product->is_type( 'variable' ) || is_array( $edit_context ) ) && '' === $embed_token ) {
            return;
        }
        $edit_nonce = '' !== $edit_cart_key ? wp_create_nonce( 'pkc_update_cart_customisation_' . $edit_cart_key ) : '';
        $price_modifier_display = $this->price_modifier_display( $price_modifier_minor );

        $iframe_url = add_query_arg(
            array(
                'parent_origin'  => $parent_origin,
                'correlation_id' => $correlation_id,
            ),
            $webapp_url . '/'
        );

        echo '<div class="pkc-customiser" data-pkc-customiser data-customiser-origin="' . esc_attr( $customiser_origin ) . '" data-correlation-id="' . esc_attr( $correlation_id ) . '" data-api-url="' . esc_attr( $api_url ) . '" data-embed-token="' . esc_attr( $embed_token ) . '" data-product-id="' . esc_attr( (string) $product->get_id() ) . '" data-price-modifier-minor="' . esc_attr( (string) $price_modifier_minor ) . '" data-ajax-url="' . esc_url( admin_url( 'admin-ajax.php' ) ) . '" data-ajax-nonce="' . esc_attr( wp_create_nonce( 'pkc_refresh_embed_token' ) ) . '" data-edit-reference="' . esc_attr( $edit_reference ) . '" data-edit-cart-key="' . esc_attr( $edit_cart_key ) . '" data-edit-variant="' . esc_attr( $initial_variant_id ) . '" data-edit-nonce="' . esc_attr( $edit_nonce ) . '"><iframe data-pkc-iframe title="' . esc_attr__( 'Personalise this product', 'personalise-kings-connector' ) . '" src="' . esc_url( $iframe_url ) . '" loading="lazy" style="width:100%;min-height:640px;border:0;border-radius:16px;"></iframe><input type="hidden" name="pk_customisation_reference" value="' . esc_attr( $edit_reference ) . '" /><p data-pkc-price-adjustment' . ( 0 === $price_modifier_minor ? ' hidden' : '' ) . '>' . wp_kses_post( $price_modifier_display ) . '</p><p data-pkc-status role="status" aria-live="polite" hidden></p></div>';
    }

    /**
     * Request a short-lived embed token from the webapp API.
     *
     * @param string $api_url        API base URL.
     * @param string $store_id       Store ID.
     * @param string $parent_origin  Parent origin.
     * @param string $product_id     Product ID.
     * @param string $variant_id     Variant ID.
     * @param string $correlation_id Correlation ID.
     * @return array{embed_token:string,price_modifier_minor:int}|null
     */
    private function request_embed_token( string $api_url, string $store_id, string $parent_origin, string $product_id, string $variant_id, string $correlation_id ): ?array {
        $body = wp_json_encode(
            array_filter(
                array(
                    'store_id'             => $store_id,
                    'parent_origin'        => $parent_origin,
                    'external_product_id'  => $product_id,
                    'external_variant_id'  => $variant_id,
                )
            )
        );

        if ( ! is_string( $body ) ) {
            return null;
        }

        $key_id = (string) get_option( PKC_Settings::OPTION_KEY_ID, '' );
        $secret = (string) get_option( PKC_Settings::OPTION_SECRET, '' );
        if ( '' === $key_id || '' === $secret ) {
            return null;
        }

        $response = wp_remote_post(
            $api_url . '/v1/customiser/embed-token',
            array(
                'timeout' => 8,
                'headers' => array(
                    'Content-Type'     => 'application/json',
                    'X-Correlation-ID' => $correlation_id,
                    'X-PK-Key-ID'      => $key_id,
                    'X-PK-Signature'   => 'sha256=' . hash_hmac( 'sha256', $body, $secret ),
                ),
                'body'    => $body,
            )
        );

        if ( is_wp_error( $response ) ) {
            return null;
        }

        $decoded = json_decode( (string) wp_remote_retrieve_body( $response ), true );
        if ( ! is_array( $decoded ) || empty( $decoded['embed_token'] ) || ! isset( $decoded['price_modifier_minor'] ) ) {
            return null;
        }

        $config = array(
            'embed_token'         => (string) $decoded['embed_token'],
            'price_modifier_minor' => (int) $decoded['price_modifier_minor'],
        );
        $this->cache_mapping_details( $store_id, $product_id, $variant_id, true, $config['price_modifier_minor'] );
        return $config;
    }

    /**
     * Check whether a variable product has at least one active mapping before rendering the iframe shell.
     *
     * @param string $api_url        API base URL.
     * @param string $store_id       Store ID.
     * @param string $product_id     Product ID.
     * @param string $correlation_id Correlation ID.
     */
    private function has_product_mapping( string $api_url, string $store_id, string $product_id, string $correlation_id ): bool {
        $mapping = $this->lookup_product_mapping( $api_url, $store_id, $product_id, '', $correlation_id );
        return is_array( $mapping ) && $mapping['mapped'];
    }

    /**
     * Resolve signed mapping details, using a short local cache for checkout resilience.
     *
     * @param string $api_url        API base URL.
     * @param string $store_id       Store ID.
     * @param string $product_id     Product ID.
     * @param string $variant_id     Variation ID or an empty string.
     * @param string $correlation_id Correlation ID.
     * @return array{mapped:bool,price_modifier_minor:int}|null
     */
    private function lookup_product_mapping( string $api_url, string $store_id, string $product_id, string $variant_id, string $correlation_id ): ?array {
        $cached = get_transient( $this->mapping_cache_key( $store_id, $product_id, $variant_id ) );
        if ( is_array( $cached ) && isset( $cached['mapped'], $cached['price_modifier_minor'] ) ) {
            return array(
                'mapped'               => (bool) $cached['mapped'],
                'price_modifier_minor' => (int) $cached['price_modifier_minor'],
            );
        }

        $body = wp_json_encode(
            array_filter(
                array(
                    'store_id'            => $store_id,
                    'external_product_id' => $product_id,
                    'external_variant_id' => $variant_id,
                )
            )
        );
        $key_id = (string) get_option( PKC_Settings::OPTION_KEY_ID, '' );
        $secret = (string) get_option( PKC_Settings::OPTION_SECRET, '' );
        if ( ! is_string( $body ) || '' === $key_id || '' === $secret ) {
            return null;
        }

        $response = wp_remote_post(
            $api_url . '/v1/customiser/mapping-lookup',
            array(
                'timeout' => 8,
                'headers' => array(
                    'Content-Type'     => 'application/json',
                    'X-Correlation-ID' => $correlation_id,
                    'X-PK-Key-ID'      => $key_id,
                    'X-PK-Signature'   => 'sha256=' . hash_hmac( 'sha256', $body, $secret ),
                ),
                'body'    => $body,
            )
        );
        if ( is_wp_error( $response ) || 200 !== wp_remote_retrieve_response_code( $response ) ) {
            return null;
        }

        $decoded = json_decode( (string) wp_remote_retrieve_body( $response ), true );
        if ( ! is_array( $decoded ) || ! isset( $decoded['mapped'] ) ) {
            return null;
        }
        $mapping = array(
            'mapped'               => (bool) $decoded['mapped'],
            'price_modifier_minor' => isset( $decoded['price_modifier_minor'] ) ? (int) $decoded['price_modifier_minor'] : 0,
        );
        $this->cache_mapping_details( $store_id, $product_id, $variant_id, $mapping['mapped'], $mapping['price_modifier_minor'] );
        return $mapping;
    }

    /**
     * Store mapping details briefly so a temporary API outage does not alter an in-progress add-to-cart request.
     *
     * @param string $store_id             Store ID.
     * @param string $product_id           Product ID.
     * @param string $variant_id           Variation ID or an empty string.
     * @param bool   $mapped               Whether a mapping exists.
     * @param int    $price_modifier_minor Price change in currency minor units.
     */
    private function cache_mapping_details( string $store_id, string $product_id, string $variant_id, bool $mapped, int $price_modifier_minor ): void {
        set_transient(
            $this->mapping_cache_key( $store_id, $product_id, $variant_id ),
            array( 'mapped' => $mapped, 'price_modifier_minor' => $price_modifier_minor ),
            5 * MINUTE_IN_SECONDS
        );
    }

    /**
     * Build a non-secret cache key for one external product mapping lookup.
     *
     * @param string $store_id   Store ID.
     * @param string $product_id Product ID.
     * @param string $variant_id Variation ID or an empty string.
     */
    private function mapping_cache_key( string $store_id, string $product_id, string $variant_id ): string {
        return 'pkc_mapping_' . hash( 'sha256', $store_id . '|' . $product_id . '|' . $variant_id );
    }

    /**
     * Return a fresh variant-bound token to the product page.
     */
    public function refresh_embed_token(): void {
        check_ajax_referer( 'pkc_refresh_embed_token', 'nonce' );

        $product_id   = isset( $_POST['product_id'] ) ? absint( $_POST['product_id'] ) : 0;
        $variation_id = isset( $_POST['variation_id'] ) ? absint( $_POST['variation_id'] ) : 0;
        $variation    = wc_get_product( $variation_id );

        if ( ! $variation instanceof WC_Product_Variation || $product_id !== $variation->get_parent_id() ) {
            wp_send_json_error( array( 'message' => __( 'Invalid product variation.', 'personalise-kings-connector' ) ), 400 );
        }

        $api_url        = rtrim( (string) get_option( PKC_Settings::OPTION_API_URL, '' ), '/' );
        $store_id       = (string) get_option( PKC_Settings::OPTION_STORE_ID, '' );
        $correlation_id = isset( $_POST['correlation_id'] ) ? sanitize_text_field( wp_unslash( $_POST['correlation_id'] ) ) : '';
        if ( '' === $api_url || '' === $store_id || ! wp_is_uuid( $correlation_id ) ) {
            wp_send_json_error( array( 'message' => __( 'Connector configuration is incomplete.', 'personalise-kings-connector' ) ), 503 );
        }

        $config = $this->request_embed_token( $api_url, $store_id, $this->url_origin( home_url() ), (string) $product_id, (string) $variation_id, $correlation_id );
        if ( ! is_array( $config ) ) {
            wp_send_json_error( array( 'message' => __( 'Unable to initialize this variation.', 'personalise-kings-connector' ) ), 502 );
        }

        wp_send_json_success(
            array(
                'embed_token'          => $config['embed_token'],
                'external_variant_id'  => (string) $variation_id,
                'price_modifier_minor' => $config['price_modifier_minor'],
                'price_modifier_display' => $this->price_modifier_display( $config['price_modifier_minor'] ),
            )
        );
    }

    /**
     * Reduce a configured URL to scheme, host, and explicit port when present.
     *
     * @param string $url URL to reduce.
     */
    private function url_origin( string $url ): string {
        $parts = wp_parse_url( $url );
        if ( ! is_array( $parts ) || empty( $parts['scheme'] ) || empty( $parts['host'] ) ) {
            return '';
        }

        return strtolower( (string) $parts['scheme'] ) . '://' . strtolower( (string) $parts['host'] ) . ( isset( $parts['port'] ) ? ':' . (int) $parts['port'] : '' );
    }

    /**
     * Require a committed reference for mapped products and resolve authoritative mapping details.
     *
     * @param bool                 $passed       Existing validation result.
     * @param int                  $product_id   Product ID.
     * @param int                  $quantity     Requested quantity.
     * @param int                  $variation_id Variation ID.
     * @param array<string, mixed> $variations   Selected variation attributes.
     */
    public function validate_add_to_cart( bool $passed, int $product_id, int $quantity, int $variation_id = 0, array $variations = array() ): bool {
        unset( $quantity, $variations );
        if ( ! $passed ) {
            return false;
        }

        $api_url = rtrim( (string) get_option( PKC_Settings::OPTION_API_URL, '' ), '/' );
        $store_id = (string) get_option( PKC_Settings::OPTION_STORE_ID, '' );
        if ( '' === $api_url || '' === $store_id ) {
            return $passed;
        }
        $mapping = $this->lookup_product_mapping( $api_url, $store_id, (string) $product_id, $variation_id > 0 ? (string) $variation_id : '', wp_generate_uuid4() );
        $reference = isset( $_POST['pk_customisation_reference'] ) ? sanitize_text_field( wp_unslash( $_POST['pk_customisation_reference'] ) ) : '';
        if ( null === $mapping ) {
            if ( $this->is_valid_reference( $reference ) ) {
                wc_add_notice( __( 'Personalisation could not be verified. Please try again.', 'personalise-kings-connector' ), 'error' );
                return false;
            }
            return $passed;
        }
        if ( $mapping['mapped'] && ! $this->is_valid_reference( $reference ) ) {
            wc_add_notice( __( 'Please save your personalisation before adding this product to the cart.', 'personalise-kings-connector' ), 'error' );
            return false;
        }
        if ( ! $mapping['mapped'] && $this->is_valid_reference( $reference ) ) {
            wc_add_notice( __( 'This product is no longer mapped for personalisation.', 'personalise-kings-connector' ), 'error' );
            return false;
        }
        return $passed;
    }

    /**
     * Attach the committed customisation reference to the cart item.
     *
     * @param array<string, mixed> $cart_item_data Cart item data.
     * @param int                  $product_id     Product ID.
     * @param int                  $variation_id   Variation ID.
     * @param int                  $quantity       Requested quantity.
     * @return array<string, mixed>
     */
    public function add_cart_item_data( array $cart_item_data, int $product_id, int $variation_id, int $quantity ): array {
        unset( $quantity );
        $reference = isset( $_POST['pk_customisation_reference'] ) ? sanitize_text_field( wp_unslash( $_POST['pk_customisation_reference'] ) ) : '';
        if ( ! $this->is_valid_reference( $reference ) ) {
            return $cart_item_data;
        }

        $mapping = $this->lookup_product_mapping(
            rtrim( (string) get_option( PKC_Settings::OPTION_API_URL, '' ), '/' ),
            (string) get_option( PKC_Settings::OPTION_STORE_ID, '' ),
            (string) $product_id,
            $variation_id > 0 ? (string) $variation_id : '',
            wp_generate_uuid4()
        );
        if ( ! is_array( $mapping ) || ! $mapping['mapped'] ) {
            return $cart_item_data;
        }

        $cart_item_data['pk_customisation_reference'] = $reference;
        $cart_item_data['pk_price_modifier_minor'] = $mapping['price_modifier_minor'];

        return $cart_item_data;
    }

    /**
     * Persist the customisation reference onto the order item.
     *
     * @param WC_Order_Item_Product $item          Order line item.
     * @param string                $cart_item_key Cart item key.
     * @param array<string, mixed>  $values        Cart item values.
     * @param WC_Order              $order         Order object.
     */
    public function add_order_item_data( WC_Order_Item_Product $item, string $cart_item_key, array $values, WC_Order $order ): void {
        unset( $cart_item_key, $order );

        if ( empty( $values['pk_customisation_reference'] ) ) {
            return;
        }

        $item->add_meta_data( '_pk_customisation_reference', sanitize_text_field( (string) $values['pk_customisation_reference'] ), true );
        $item->add_meta_data( __( 'PersonaliseKings reference', 'personalise-kings-connector' ), sanitize_text_field( (string) $values['pk_customisation_reference'] ), true );
        if ( isset( $values['pk_price_modifier_minor'] ) ) {
            $item->add_meta_data( '_pk_price_modifier_minor', (int) $values['pk_price_modifier_minor'], true );
        }
    }

    /**
     * Display customisation reference in cart/order item summaries.
     *
     * @param array<int, array<string, string>> $item_data Cart item display data.
     * @param array<string, mixed>              $cart_item Cart item values.
     * @return array<int, array<string, string>>
     */
    public function display_cart_item_data( array $item_data, array $cart_item ): array {
        if ( empty( $cart_item['pk_customisation_reference'] ) ) {
            return $item_data;
        }

        $item_data[] = array(
            'key'   => __( 'PersonaliseKings reference', 'personalise-kings-connector' ),
            'value' => esc_html( (string) $cart_item['pk_customisation_reference'] ),
        );
        $modifier_minor = isset( $cart_item['pk_price_modifier_minor'] ) ? (int) $cart_item['pk_price_modifier_minor'] : 0;
        if ( 0 !== $modifier_minor ) {
            $item_data[] = array(
                'key'     => __( 'Personalisation price', 'personalise-kings-connector' ),
                'value'   => (string) $modifier_minor,
                'display' => wc_price( $this->minor_to_decimal( $modifier_minor ) ),
            );
        }

        return $item_data;
    }

    /**
     * Apply each mapping's authoritative modifier from the original product price.
     *
     * @param WC_Cart $cart WooCommerce cart.
     */
    public function apply_price_modifiers( WC_Cart $cart ): void {
        if ( is_admin() && ! wp_doing_ajax() ) {
            return;
        }

        foreach ( $cart->get_cart() as $cart_item_key => $cart_item ) {
            if ( empty( $cart_item['data'] ) || ! ( $cart_item['data'] instanceof WC_Product ) || ! isset( $cart_item['pk_price_modifier_minor'] ) ) {
                continue;
            }
            $base_price = isset( $cart_item['_pk_base_price'] )
                ? (float) $cart_item['_pk_base_price']
                : (float) $cart_item['data']->get_price( 'edit' );
            $cart->cart_contents[ $cart_item_key ]['_pk_base_price'] = $base_price;
            $modified_price = max( 0.0, $base_price + $this->minor_to_decimal( (int) $cart_item['pk_price_modifier_minor'] ) );
            $cart_item['data']->set_price( $modified_price );
        }
    }

    /**
     * Add a cart-only link that reopens this line's saved customisation.
     *
     * @param string               $product_name  Rendered product name.
     * @param array<string, mixed> $cart_item     Cart item data.
     * @param string               $cart_item_key Cart item key.
     */
    public function add_cart_edit_link( string $product_name, array $cart_item, string $cart_item_key ): string {
        if ( ! is_cart() || empty( $cart_item['pk_customisation_reference'] ) || empty( $cart_item['data'] ) || ! ( $cart_item['data'] instanceof WC_Product ) ) {
            return $product_name;
        }

        $edit_url = add_query_arg( 'pkc_edit_cart_item', $cart_item_key, $cart_item['data']->get_permalink( $cart_item ) );
        return $product_name . '<br><a class="pkc-edit-customisation" href="' . esc_url( $edit_url ) . '">' . esc_html__( 'Edit personalisation', 'personalise-kings-connector' ) . '</a>';
    }

    /**
     * Replace a cart line's customisation reference after an iframe edit.
     */
    public function update_cart_customisation(): void {
        $cart_item_key = isset( $_POST['cart_item_key'] ) ? sanitize_text_field( wp_unslash( $_POST['cart_item_key'] ) ) : '';
        $nonce = isset( $_POST['nonce'] ) ? sanitize_text_field( wp_unslash( $_POST['nonce'] ) ) : '';
        if ( '' === $cart_item_key || ! wp_verify_nonce( $nonce, 'pkc_update_cart_customisation_' . $cart_item_key ) ) {
            wp_send_json_error( array( 'message' => __( 'The cart edit session has expired.', 'personalise-kings-connector' ) ), 403 );
        }

        $old_reference = isset( $_POST['old_reference'] ) ? sanitize_text_field( wp_unslash( $_POST['old_reference'] ) ) : '';
        $new_reference = isset( $_POST['new_reference'] ) ? sanitize_text_field( wp_unslash( $_POST['new_reference'] ) ) : '';
        $cart = WC()->cart ? WC()->cart->get_cart() : array();
        $cart_item = $cart[ $cart_item_key ] ?? null;
        $current_reference = is_array( $cart_item ) && isset( $cart_item['pk_customisation_reference'] )
            ? (string) $cart_item['pk_customisation_reference']
            : '';

        if ( ! is_array( $cart_item ) || ! $this->is_valid_reference( $old_reference ) || ! $this->is_valid_reference( $new_reference )
            || ! hash_equals( $current_reference, $old_reference ) ) {
            wp_send_json_error( array( 'message' => __( 'The cart item no longer matches this customisation.', 'personalise-kings-connector' ) ), 409 );
        }

        $cart_item['pk_customisation_reference'] = $new_reference;
        unset( $cart_item['unique_key'] );
        $new_cart_item_key = $this->cart_item_key( $cart_item );
        if ( $new_cart_item_key !== $cart_item_key && isset( WC()->cart->cart_contents[ $new_cart_item_key ] ) ) {
            $merged_quantity = (int) WC()->cart->cart_contents[ $new_cart_item_key ]['quantity'] + (int) $cart_item['quantity'];
            unset( WC()->cart->cart_contents[ $cart_item_key ] );
            WC()->cart->set_quantity( $new_cart_item_key, $merged_quantity, false );
        } elseif ( $new_cart_item_key !== $cart_item_key ) {
            unset( WC()->cart->cart_contents[ $cart_item_key ] );
            WC()->cart->cart_contents[ $new_cart_item_key ] = $cart_item;
        } else {
            WC()->cart->cart_contents[ $cart_item_key ] = $cart_item;
        }
        WC()->cart->calculate_totals();
        WC()->cart->set_session();
        wp_send_json_success( array( 'redirect_url' => wc_get_cart_url() ) );
    }

    /**
     * Recreate WooCommerce's cart identity after an edited reference changes.
     *
     * @param array<string, mixed> $cart_item Cart item data.
     */
    private function cart_item_key( array $cart_item ): string {
        $identity_data = $cart_item;
        foreach ( array( 'product_id', 'variation_id', 'variation', 'quantity', 'data', 'data_hash', 'line_tax_data', 'line_subtotal', 'line_subtotal_tax', 'line_total', 'line_tax', '_pk_base_price' ) as $reserved_key ) {
            unset( $identity_data[ $reserved_key ] );
        }
        return WC()->cart->generate_cart_id(
            (int) $cart_item['product_id'],
            (int) ( $cart_item['variation_id'] ?? 0 ),
            isset( $cart_item['variation'] ) && is_array( $cart_item['variation'] ) ? $cart_item['variation'] : array(),
            $identity_data
        );
    }

    /**
     * Resolve a cart edit key to the current customer's matching cart data.
     *
     * @param string $product_id Current product ID.
     * @return array{cart_item_key:string,reference:string,variation_id:string}|null
     */
    private function get_cart_edit_context( string $product_id ): ?array {
        $cart_item_key = isset( $_GET['pkc_edit_cart_item'] ) ? sanitize_text_field( wp_unslash( $_GET['pkc_edit_cart_item'] ) ) : '';
        if ( '' === $cart_item_key || ! WC()->cart ) {
            return null;
        }

        $cart = WC()->cart->get_cart();
        $cart_item = $cart[ $cart_item_key ] ?? null;
        $reference = is_array( $cart_item ) && isset( $cart_item['pk_customisation_reference'] )
            ? (string) $cart_item['pk_customisation_reference']
            : '';
        if ( ! is_array( $cart_item ) || (string) ( $cart_item['product_id'] ?? '' ) !== $product_id || ! $this->is_valid_reference( $reference ) ) {
            return null;
        }

        return array(
            'cart_item_key' => $cart_item_key,
            'reference'     => $reference,
            'variation_id'  => ! empty( $cart_item['variation_id'] ) ? (string) $cart_item['variation_id'] : '',
        );
    }

    /**
     * Convert currency minor units using the active WooCommerce decimal setting.
     *
     * @param int $minor_units Amount in currency minor units.
     */
    private function minor_to_decimal( int $minor_units ): float {
        return $minor_units / ( 10 ** wc_get_price_decimals() );
    }

    /**
     * Format a storefront explanation for a non-zero personalisation price change.
     *
     * @param int $minor_units Amount in currency minor units.
     */
    private function price_modifier_display( int $minor_units ): string {
        if ( 0 === $minor_units ) {
            return '';
        }
        return sprintf(
            esc_html__( 'Personalisation price adjustment: %s', 'personalise-kings-connector' ),
            wc_price( $this->minor_to_decimal( $minor_units ) )
        );
    }

    /**
     * Validate API-issued opaque references before trusting posted cart data.
     *
     * @param string $reference Candidate reference.
     */
    private function is_valid_reference( string $reference ): bool {
        return 1 === preg_match( '/^pk_[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i', $reference );
    }
}
