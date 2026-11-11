'use strict';

const profiles = Object.freeze({
  normal: Object.freeze({
    plan: 'PAYMENT_NORMAL_LOOPBACK_TLS_V1',
    topology: 'UNVERIFIED_PAYMENT_NORMAL_LOOPBACK_TLS'
  }),
  'response-loss': Object.freeze({
    plan: 'PAYMENT_RESPONSE_LOSS_LOOPBACK_TLS_V1',
    topology: 'UNVERIFIED_PAYMENT_RESPONSE_LOSS_LOOPBACK_TLS'
  }),
  competition: Object.freeze({
    plan: 'PAYMENT_COMPETITION_LOOPBACK_TLS_V1',
    topology: 'UNVERIFIED_PAYMENT_COMPETITION_LOOPBACK_TLS'
  }),
  'disconnect-commit-recovery': Object.freeze({
    plan: 'PAYMENT_DISCONNECT_RECOVERY_LOOPBACK_TLS_V1',
    topology: 'UNVERIFIED_PAYMENT_DISCONNECT_RECOVERY_LOOPBACK_TLS'
  }),
  'attribution-gap': Object.freeze({
    plan: 'PAYMENT_ATTRIBUTION_GAP_LOOPBACK_TLS_V1',
    topology: 'UNVERIFIED_PAYMENT_ATTRIBUTION_GAP_LOOPBACK_TLS'
  }),
  'cancel-commit': Object.freeze({
    plan: 'FIRST_ROLLBACK_LOOPBACK_TLS_V1',
    topology: 'UNVERIFIED_FIRST_ROLLBACK_LOOPBACK_TLS'
  })
});
const topologies = new Set(Object.values(profiles).map(profile => profile.topology));

function paymentLoopbackForScenario(scenario) {
  return typeof scenario === 'string' && Object.hasOwn(profiles, scenario) ? profiles[scenario] : undefined;
}

function isCurrent259PaymentLoopbackTopology(topology) {
  return topologies.has(topology);
}

module.exports = Object.freeze({ paymentLoopbackForScenario, isCurrent259PaymentLoopbackTopology });
