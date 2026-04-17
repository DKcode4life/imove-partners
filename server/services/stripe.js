const config = require('../config');

// TODO: npm install stripe

function getClient() {
  if (!config.stripe.secretKey) {
    throw new Error('STRIPE_SECRET_KEY not configured');
  }
  // const Stripe = require('stripe');
  // return new Stripe(config.stripe.secretKey);
  throw new Error('Stripe not yet implemented — install stripe and uncomment');
}

async function createPaymentIntent({ amount, currency = 'gbp', metadata = {} }) {
  // const stripe = getClient();
  // return stripe.paymentIntents.create({
  //   amount: Math.round(amount * 100), // Stripe uses pence
  //   currency,
  //   metadata,
  // });
  console.log(`[stripe] Would create payment intent: £${amount}`);
  return { id: 'pi_placeholder', amount, currency, status: 'skipped' };
}

async function createCheckoutSession({ lineItems, successUrl, cancelUrl, metadata = {} }) {
  // const stripe = getClient();
  // return stripe.checkout.sessions.create({
  //   payment_method_types: ['card'],
  //   line_items: lineItems,
  //   mode: 'payment',
  //   success_url: successUrl,
  //   cancel_url: cancelUrl,
  //   metadata,
  // });
  console.log(`[stripe] Would create checkout session`);
  return { id: 'cs_placeholder', url: successUrl, status: 'skipped' };
}

async function handleWebhook(rawBody, signature) {
  // const stripe = getClient();
  // const event = stripe.webhooks.constructEvent(
  //   rawBody,
  //   signature,
  //   config.stripe.webhookSecret,
  // );
  // return event;
  throw new Error('Stripe webhooks not yet implemented');
}

module.exports = { createPaymentIntent, createCheckoutSession, handleWebhook };
