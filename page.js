// Base token rates for the local simulation, before the program's price multiplier.
const nodes = [
  {id: '853a…edbc', limit: 8192, promptRate: 2, outputRate: 5},
  {id: '03e8…86cf', limit: 2048, promptRate: 1, outputRate: 4},
  {id: '1c0a…dc13', limit: 4096, promptRate: 3, outputRate: 3},
  {id: 'a1d9…793f', limit: 512, promptRate: 4, outputRate: 2},
];
const sellerId = document.querySelector('#seller-node-id').textContent;
const sellerAsks = new Map();

const market = document.querySelector('#example-market');
const buyerForm = market.querySelector('#buyer-request');
const sellerForm = market.querySelector('#seller-rule');
const programInput = market.querySelector('#rfq-program');
const promptInput = document.querySelector('#job-prompt');
const limit = document.querySelector('#decode-limit');
const quoteStatus = document.querySelector('#quote-status');
const standingStatus = quoteStatus.textContent;
const sellerLimit = sellerForm.querySelector('#node-limit');
const sellerPromptRate = sellerForm.querySelector('#node-prompt');
const sellerOutputRate = sellerForm.querySelector('#node-output');
const publishAsk = sellerForm.querySelector('#publish-ask');
let active = null;
let timers = [];

function showPrice(cell, value) {
  const coin = document.createElement('img');
  coin.className = 'token-coin';
  coin.src = 'assets/coin.svg';
  coin.alt = 'Hellas tokens:';
  cell.append(coin, value.toLocaleString('en-US'));
}

// Approximation for the offline preview. Production quotes need the pinned tokenizer.
function estimatedPromptTokens() {
  return Math.ceil(new TextEncoder().encode(promptInput.value).length / 4);
}

function updateDraft() {
  promptInput.setCustomValidity(promptInput.value.trim() ? '' : 'Enter a prompt.');
  document.querySelector('#prompt-size').textContent = 'Estimated prompt tokens: ' + estimatedPromptTokens();
}

function programQuote(node) {
  const multiplier = Number(programInput.selectedOptions[0].dataset.rateMultiplier);
  return {...node, promptRate: node.promptRate * multiplier, outputRate: node.outputRate * multiplier};
}

function standingQuotes() {
  const standing = nodes.slice(0, 3).map(programQuote);
  const sellerAsk = sellerAsks.get(programInput.value);
  return sellerAsk ? [...standing, sellerAsk] : standing;
}

function clearQuoteTimers() {
  timers.forEach(clearTimeout);
  timers = [];
}

function selectProgram() {
  const {weights, validity, rateMultiplier} = programInput.selectedOptions[0].dataset;
  document.querySelector('#weights-field').hidden = !weights;
  const weightInput = document.querySelector('#rfq-weights');
  weightInput.replaceChildren();
  if (weights) weightInput.add(new Option(weights));
  document.querySelector('#rfq-validity').replaceChildren(new Option(validity));

  clearQuoteTimers();
  active = null;
  document.querySelector('#quoted-job').hidden = true;
  quoteStatus.textContent = standingStatus;

  const sellerAsk = sellerAsks.get(programInput.value);
  sellerLimit.value = sellerAsk?.limit ?? sellerLimit.defaultValue;
  sellerPromptRate.value = sellerAsk?.promptRate ?? Number(sellerPromptRate.defaultValue) * Number(rateMultiplier);
  sellerOutputRate.value = sellerAsk?.outputRate ?? Number(sellerOutputRate.defaultValue) * Number(rateMultiplier);
  publishAsk.textContent = sellerAsk ? 'Update sell order' : 'Place sell order';
  document.querySelector('#rule-status').textContent = '';
  renderBook();
}

function renderBook(updatedProviderId) {
  const rows = document.querySelector('#job-quotes');
  rows.replaceChildren();
  const cards = active ? [...active.cards.values()] : standingQuotes();
  const job = active?.job ?? {promptTokens: estimatedPromptTokens(), limit: limit.valueAsNumber};
  const valid = Boolean(active) || (promptInput.validity.valid && limit.validity.valid);
  const quotes = cards.map(card => {
    const eligible = valid && job.limit <= card.limit;
    return {...card, ask: eligible ? card.promptRate * job.promptTokens + card.outputRate * job.limit : null};
  }).sort((a, b) => (a.ask ?? Infinity) - (b.ask ?? Infinity));
  for (const card of quotes) {
    const row = rows.insertRow();
    row.classList.toggle('quote-updated', card.id === updatedProviderId);
    row.classList.toggle('best-ask', card.ask !== null && card.ask === quotes[0].ask);
    const provider = row.insertCell();
    provider.textContent = card.id;
    if (card.id === sellerId) {
      const marker = document.createElement('span');
      marker.className = 'yellow';
      marker.textContent = '(you)';
      provider.append(' ', marker);
    }
    showPrice(row.insertCell(), card.promptRate);
    showPrice(row.insertCell(), card.outputRate);
    const total = row.insertCell();
    if (card.ask !== null) showPrice(total, card.ask);
    else total.textContent = valid ? 'Over limit' : '—';
  }
  document.querySelector('#ask-count').textContent = active
    ? cards.length + ' providers'
    : cards.length + ' standing quotes';
  if (active) quoteStatus.textContent = active.complete
    ? ''
    : 'Refreshing quotes for the submitted prompt…';
}

buyerForm.addEventListener('input', () => {
  updateDraft();
  if (!active) renderBook();
});
buyerForm.addEventListener('submit', event => {
  event.preventDefault();
  updateDraft();
  if (!buyerForm.reportValidity()) return;
  clearQuoteTimers();

  const {weights, validity} = programInput.selectedOptions[0].dataset;
  const job = Object.freeze({
    prompt: promptInput.value, promptTokens: estimatedPromptTokens(), limit: limit.valueAsNumber,
    program: programInput.value, validity,
    ...(weights ? {weights} : {}),
    prefix: document.querySelector('#rfq-prefix').value
  });
  // Three nodes reprice and one more can join the book.
  const updates = [
    {...nodes[0], outputRate: 4}, {...nodes[2], promptRate: 2}, {...nodes[1], outputRate: 3}, nodes[3]
  ].filter(node => job.limit <= node.limit).map(programQuote);
  const request = {
    job, cards: new Map(standingQuotes().map(node => [node.id, node])), complete: updates.length === 0
  };
  active = request;
  document.querySelector('#quoted-job').hidden = false;
  document.querySelector('#rfq-reference').textContent = '~' + job.promptTokens + ' prompt tokens · max ' + job.limit + ' new tokens';
  document.querySelector('#submitted-message').textContent = job.prompt;
  renderBook();
  // Stream updated rates and new providers on doubling intervals.
  updates.forEach((offer, i) => {
    timers.push(setTimeout(() => {
      if (active !== request) return;
      request.cards.set(offer.id, offer);
      request.complete = i === updates.length - 1;
      renderBook(offer.id);
    }, 200 * (2 ** (i + 1) - 1)));
  });
});

market.querySelector('.book-toggle').addEventListener('change', () => {
  const selling = document.querySelector('#side-sell').checked;
  buyerForm.hidden = selling;
  sellerForm.hidden = !selling;
});
sellerForm.addEventListener('submit', event => {
  event.preventDefault();
  if (!sellerForm.reportValidity()) return;
  const updating = sellerAsks.has(programInput.value);
  const sellerAsk = {
    id: sellerId,
    promptRate: sellerPromptRate.valueAsNumber,
    limit: sellerLimit.valueAsNumber,
    outputRate: sellerOutputRate.valueAsNumber
  };
  sellerAsks.set(programInput.value, sellerAsk);
  if (active) active.cards.set(sellerId, sellerAsk);
  renderBook();
  publishAsk.textContent = 'Update sell order';
  document.querySelector('#rule-status').textContent = (updating ? 'Sell order updated for ' : 'Sell order placed for ') + sellerId + '.';
});
programInput.addEventListener('change', selectProgram);
updateDraft();
selectProgram();
market.hidden = false;
