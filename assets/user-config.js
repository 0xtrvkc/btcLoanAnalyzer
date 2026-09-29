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
    btc: 0.03565762,              // BTC pledged as collateral
    loanPrincipal: 1000,     // Original fixed loan amount in USD
    loanDate: '2026-09-27',  // Date the loan was used to buy BTC
    ltv: 33.77,                 // Used only if loanPrincipal is blank or 0
    entry: 84900.86,            // Cost basis of your original BTC
    deployPrice: 84900.86,      // Price where loan money bought BTC
    deploy: 100,             // Percent of loan used to buy BTC
    apr: 5,                  // APR used for daily simple interest
    target: 169801.72           // Target BTC price
  });
});
