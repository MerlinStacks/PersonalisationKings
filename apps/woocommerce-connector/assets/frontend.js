(function () {
  var container = document.querySelector('[data-pkc-customiser]');
  if (!container) return;

  var iframe = container.querySelector('[data-pkc-iframe]');
  var referenceInput = container.querySelector('input[name="pk_customisation_reference"]');
  var status = container.querySelector('[data-pkc-status]');
  var priceAdjustment = container.querySelector('[data-pkc-price-adjustment]');
  var cartForm = container.closest('form.cart');
  var addToCartButton = cartForm && cartForm.querySelector('.single_add_to_cart_button');
  var customiserOrigin = container.dataset.customiserOrigin;
  var correlationId = container.dataset.correlationId;
  var currentVariant = container.dataset.editVariant || '';
  var refreshSequence = 0;
  var cartUpdatePending = false;

  if (addToCartButton && container.dataset.editCartKey) addToCartButton.hidden = true;

  function messageId() {
    return window.crypto && window.crypto.randomUUID ? window.crypto.randomUUID() : String(Date.now()) + Math.random();
  }

  function post(event, payload) {
    if (!iframe || !iframe.contentWindow || !customiserOrigin) return;
    iframe.contentWindow.postMessage({
      protocol: 'pk-embed.v1',
      event: event,
      payload: payload,
      message_id: messageId(),
      correlation_id: correlationId,
      sent_at: new Date().toISOString()
    }, customiserOrigin);
  }

  function initialize(token, variantId) {
    if (!token) return;
    post('initialize', {
      api_url: container.dataset.apiUrl,
      embed_token: token,
      external_variant_id: variantId || undefined,
      price_modifier_minor: Number(container.dataset.priceModifierMinor || 0),
      customisation_reference: container.dataset.editReference || undefined
    });
  }

  function showStatus(message) {
    if (!status) return;
    status.hidden = false;
    status.textContent = message;
  }

  function clearCartEdit() {
    container.dataset.editReference = '';
    container.dataset.editCartKey = '';
    container.dataset.editNonce = '';
    if (addToCartButton) addToCartButton.hidden = false;
  }

  function replaceCartReference(newReference) {
    if (cartUpdatePending || !container.dataset.editCartKey) return;
    cartUpdatePending = true;
    showStatus('Updating your cart...');
    var body = new URLSearchParams({
      action: 'pkc_update_cart_customisation',
      nonce: container.dataset.editNonce,
      cart_item_key: container.dataset.editCartKey,
      old_reference: container.dataset.editReference,
      new_reference: newReference
    });
    window.fetch(container.dataset.ajaxUrl, { method: 'POST', credentials: 'same-origin', body: body })
      .then(function (response) { return response.json(); })
      .then(function (response) {
        if (!response.success || !response.data.redirect_url) {
          throw new Error(response.data && response.data.message || 'The cart could not be updated.');
        }
        window.location.assign(response.data.redirect_url);
      })
      .catch(function (error) {
        cartUpdatePending = false;
        showStatus(error && error.message || 'The cart could not be updated. Please try again.');
      });
  }

  function isMessage(data) {
    return data && typeof data === 'object' && data.protocol === 'pk-embed.v1' &&
      typeof data.event === 'string' && typeof data.message_id === 'string' &&
      typeof data.sent_at === 'string' && data.correlation_id === correlationId &&
      data.payload && typeof data.payload === 'object';
  }

  window.addEventListener('message', function (event) {
    if (event.origin !== customiserOrigin || !iframe || event.source !== iframe.contentWindow || !isMessage(event.data)) return;
    var data = event.data;

    if (data.event === 'ready') {
      initialize(container.dataset.embedToken, currentVariant);
    } else if (data.event === 'resize' && Number.isInteger(data.payload.height) && data.payload.height > 0) {
      if (iframe) {
        iframe.style.minHeight = data.payload.height + 'px';
      }
    }

    if ((data.event === 'committed' || data.event === 'add-to-cart') && typeof data.payload.customisation_reference === 'string') {
      if (referenceInput) {
        referenceInput.value = data.payload.customisation_reference;
      }
      if (data.event === 'committed' && container.dataset.editCartKey) {
        replaceCartReference(data.payload.customisation_reference);
      }
    }
  });

  if (window.jQuery) {
    window.jQuery(document).on('found_variation', 'form.variations_form', function (_event, variation) {
      var variationId = String(variation && variation.variation_id || '');
      var sequence = ++refreshSequence;
      currentVariant = variationId;
      container.dataset.embedToken = '';
      if (container.dataset.editCartKey && variationId !== container.dataset.editVariant) {
        clearCartEdit();
      }
      if (referenceInput && !container.dataset.editCartKey) referenceInput.value = '';
      post('variant-change', { external_variant_id: variationId || 'invalid' });
      if (!variationId) return;
      showStatus('Checking personalisation for this variation...');
      if (priceAdjustment) priceAdjustment.hidden = true;

      var body = new URLSearchParams({
        action: 'pkc_refresh_embed_token',
        nonce: container.dataset.ajaxNonce,
        product_id: container.dataset.productId,
        variation_id: variationId,
        correlation_id: correlationId
      });
      window.fetch(container.dataset.ajaxUrl, { method: 'POST', credentials: 'same-origin', body: body })
        .then(function (response) { return response.json(); })
        .then(function (response) {
          if (sequence !== refreshSequence) return;
          if (!response.success || !response.data.embed_token) {
            container.dataset.priceModifierMinor = '0';
            showStatus(response.data && response.data.message || 'This variation is not available for personalisation.');
            return;
          }
          container.dataset.embedToken = response.data.embed_token;
          container.dataset.priceModifierMinor = String(response.data.price_modifier_minor || 0);
          if (priceAdjustment) {
            priceAdjustment.innerHTML = response.data.price_modifier_display || '';
            priceAdjustment.hidden = !Number(response.data.price_modifier_minor || 0);
          }
          if (status) status.hidden = true;
          initialize(response.data.embed_token, variationId);
        })
        .catch(function () { showStatus('Unable to check personalisation for this variation. Please try again.'); });
    });

    window.jQuery(document).on('reset_data', 'form.variations_form', function () {
      refreshSequence++;
      currentVariant = '';
      container.dataset.embedToken = '';
      clearCartEdit();
      if (referenceInput) referenceInput.value = '';
      post('variant-change', { external_variant_id: 'unselected' });
    });
  }
}());
