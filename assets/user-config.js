/*
 * Example position shown by "Load example". It is public, so keep it fictional.
 *
 * Your real position belongs on your device, not in this repository:
 *  - In the app: fill in your loan and press "Save on this device". "Load saved" (or typing iii) restores it.
 *  - For the scheduled export: put the same fields in the POSITION_JSON repository secret, or in a
 *    git-ignored position.local.json next to package.json when running locally.
 */
(function (root, factory) {
  const preset = factory();
  if (typeof module === 'object' && module.exports) module.exports = preset;
  else root.USER_POSITION_PRESET = preset;
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';
  return Object.freeze({
    mode: 'existing',         // 'existing' for a loan you hold, 'new' to plan one
    btc: 0.5,                 // BTC pledged as collateral
    loanPrincipal: 15000,     // Original fixed loan amount in USD
    loanDate: '2026-06-01',   // Date the loan was taken (UTC)
    borrowPrice: 100000,      // BTC price when you borrowed (blank = purchase price)
    deploy: 100,              // Percent of the loan used to buy BTC
    deployPrice: 100000,      // Price paid for the loan-funded BTC
    entry: 60000,             // Cost basis of your original BTC (blank = borrow price)
    apr: 8,                   // Simple interest APR
    target: 150000,           // Target BTC price
    exitDate: ''              // Planned exit date (blank = one year from today)
  });
});
