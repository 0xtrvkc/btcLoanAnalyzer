/*
 * ================================================================
 * EDIT YOUR HIDDEN "iii" POSITION HERE
 * ================================================================
 * Change only the numbers below, save this file, then refresh the app.
 * Typing iii restores these values. Do not add commas to numbers.
 * ================================================================
 */
(function (root, factory) {
  const preset = factory();
  if (typeof module === 'object' && module.exports) module.exports = preset;
  else root.USER_POSITION_PRESET = preset;
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';
  return Object.freeze({
    btc: 0.035,              // BTC pledged as collateral
    loanPrincipal: 1000,     // Original fixed loan amount in USD
    accruedInterest: 4,      // Interest owed if you repay today, in USD
    ltv: 36,                 // Used only if loanPrincipal is blank or 0
    entry: 79422,            // Cost basis of your original BTC
    deployPrice: 79422,      // Price where loan money bought BTC
    deploy: 100,             // Percent of loan used to buy BTC
    apr: 6,                  // APR for forward projections
    months: 12,              // Forward projection period
    target: 158844           // Target BTC price
  });
});
