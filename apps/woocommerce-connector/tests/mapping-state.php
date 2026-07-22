<?php
/**
 * Minimal pure mapping snapshot tests without booting WordPress.
 *
 * @package PersonaliseKingsConnector
 */

define( 'ABSPATH', __DIR__ );
require_once dirname( __DIR__ ) . '/includes/class-pkc-frontend.php';

$snapshot = array(
    'store_id' => 'store-1',
    'variants' => array(
        '_default' => true,
        '20'       => false,
        '21'       => true,
    ),
);

$cases = array(
    array( true, $snapshot, 'store-1', '' ),
    array( true, $snapshot, 'store-1', '19' ),
    array( false, $snapshot, 'store-1', '20' ),
    array( true, $snapshot, 'store-1', '21' ),
    array( false, $snapshot, 'store-2', '21' ),
    array( false, array(), 'store-1', '' ),
);

foreach ( $cases as $index => $case ) {
    $actual = PKC_Frontend::snapshot_requires_mapping( $case[1], $case[2], $case[3] );
    if ( $case[0] !== $actual ) {
        fwrite( STDERR, 'Mapping snapshot case ' . $index . " failed\n" );
        exit( 1 );
    }
}
