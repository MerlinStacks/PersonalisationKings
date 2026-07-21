(function (blocks, element, i18n, ServerSideRender) {
  blocks.registerBlockType('personalise-kings/customiser', {
    apiVersion: 3,
    title: i18n.__('PersonaliseKings Customiser', 'personalise-kings-connector'),
    description: i18n.__('Displays the mapped customiser on a WooCommerce product.', 'personalise-kings-connector'),
    icon: 'art',
    category: 'woocommerce',
    edit: function () {
      return element.createElement(ServerSideRender, { block: 'personalise-kings/customiser' });
    },
    save: function () { return null; }
  });
}(window.wp.blocks, window.wp.element, window.wp.i18n, window.wp.serverSideRender));
