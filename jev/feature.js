/* Bounded decisions for this application. */
(function (root, factory) {
  const api = factory(
    root.JevContract || (typeof require === 'function' ? require('./contract.js') : null),
  );
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.JevFeature = api;
})(globalThis, function (C) {
  'use strict';

  const goals = {
    btc: {
      view: 'overview',
      title: 'Preserve BTC',
      description: 'Compare debt-free BTC and the two pots at the current reference price.',
    },
    debt: {
      view: 'scenarios',
      title: 'Reduce debt',
      description: 'Inspect repayment scenarios and accrued financing costs.',
    },
    liquidation: {
      view: 'risk',
      title: 'Liquidation exposure',
      description: 'Inspect LTV thresholds and stress results using the existing engine.',
    },
    compare: {
      view: 'futures',
      title: 'Compare financing structures',
      description:
        'Inspect the existing loan-versus-futures comparison and its capital assumptions.',
    },
  };
  const F = {
    id: 'loan-goals',
    private: false,
    goals,
    build(input) {
      return {
        state: { goal: C.text(input.goal, 'Your comparison goal', 600) },
        questions: {
          goal: C.choice(
            'Which existing scenario view best matches `goal`? Select a comparison, not financial advice. Do not recommend transactions or increase leverage.',
            {
              btc: 'Preserve BTC quantity or compare holding against debt-free BTC',
              debt: 'Reduce or repay debt, interest or financing costs',
              liquidation: 'Evaluate liquidation, margin-call or LTV exposure',
              compare: 'Compare loan and futures financing',
              none: 'Unsupported, unclear, or asks for a transaction rather than a comparison',
            },
          ),
        },
      };
    },
    present(input, answers) {
      const k = C.decision(answers.goal),
        g = goals[k];
      return [
        {
          title: g?.title || 'Clarify your goal',
          label:
            k === 'review' ? 'Needs review' : g ? 'Suggested comparison' : 'No matching comparison',
          detail: g?.description || 'Describe the outcome you want to compare.',
          confidence: answers.goal.confidence,
          action: g ? k : null,
        },
      ];
    },
  };

  return Object.freeze(F);
});
