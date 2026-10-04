/* Application adapter; all writes require an explicit action button. */
(function () {
  'use strict';
  function init() {
    JevUI.mount({
      title: 'Compare around your goal',
      description:
        'Describe the outcome you want to compare. Jev selects an existing analysis view; loan inputs and calculations remain unchanged.',
      fields: [
        {
          key: 'goal',
          label: 'Your goal',
          max: 600,
          placeholder: 'Compare preserving BTC with repaying the debt today',
        },
      ],
      runLabel: 'Find comparison',
      input(v) {
        return { goal: v.goal };
      },
      actionLabel: 'Open comparison',
      action(row) {
        window.JevApp.openGoal(row.action);
      },
    });
  }
  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
