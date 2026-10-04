(() => {
  'use strict';

  const TSE_BASE = 'https://resultados.tse.jus.br/oficial';
  const CONFIG_URL = `${TSE_BASE}/comum/config/ele-c.json`;
  const POLL_MS = 10_000;
  const REQUEST_TIMEOUT_MS = 8_000;
  const DEFAULT_VISIBLE = 6;

  const FALLBACK = {
    cycle: 'ele2026',
    federalElection: '6257',
    stateElection: '6259'
  };

  const OFFICES = [
    { code: 3, key: 'governador', label: 'Governador', kicker: 'EXECUTIVO ESTADUAL' },
    { code: 5, key: 'senador', label: 'Senador', kicker: 'SENADO • 2 VAGAS' },
    { code: 6, key: 'dep-federal', label: 'Deputado Federal', kicker: 'CÂMARA DOS DEPUTADOS' },
    { code: 7, key: 'dep-estadual', label: 'Deputado Estadual', kicker: 'ASSEMBLEIA LEGISLATIVA' }
  ];

  const state = {
    cycle: FALLBACK.cycle,
    federalElection: FALLBACK.federalElection,
    stateElection: FALLBACK.stateElection,
    refreshing: false,
    timer: null,
    firstSuccess: false,
    offices: new Map()
  };

  const els = {
    liveChip: document.querySelector('#liveChip'),
    liveText: document.querySelector('#liveText'),
    lastRead: document.querySelector('#lastRead'),
    refreshBtn: document.querySelector('#refreshBtn'),
    presidentList: document.querySelector('#presidentList'),
    presProgressText: document.querySelector('#presProgressText'),
    presProgressBar: document.querySelector('#presProgressBar'),
    presFoot: document.querySelector('#presFoot'),
    scOffices: document.querySelector('#scOffices'),
    prOffices: document.querySelector('#prOffices'),
    footerStatus: document.querySelector('#footerStatus'),
    officeTemplate: document.querySelector('#officeTemplate')
  };

  function normalizePercent(value) {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(String(value).replace(',', '.').replace('%', '').trim());
    return Number.isFinite(n) ? n : null;
  }

  function formatPercent(value) {
    const n = normalizePercent(value);
    return n === null ? '—' : `${n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
  }

  function formatVotes(value) {
    const n = Number(String(value ?? '').replace(/\D/g, ''));
    return Number.isFinite(n) ? n.toLocaleString('pt-BR') : '—';
  }

  function padElection(code) {
    return String(code).padStart(6, '0');
  }

  function resultUrl(uf, cargoCode, electionCode) {
    const e = padElection(electionCode);
    return `${TSE_BASE}/${state.cycle}/${electionCode}/dados/${uf}/${uf}-c${String(cargoCode).padStart(4, '0')}-e${e}-u.json`;
  }

  async function fetchJson(url) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        headers: { 'Accept': 'application/json' },
        cache: 'no-cache',
        signal: controller.signal
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } finally {
      clearTimeout(timeout);
    }
  }

  function extract2026Config(config) {
    const pleitos = Array.isArray(config?.pl) ? config.pl : [];
    const pleito = pleitos.find(p => String(p.cd) === '3220') ||
      pleitos.find(p => p.c === 'ele2026' && p.dt === '04/10/2026');

    if (!pleito) return null;
    const elections = Array.isArray(pleito.e) ? pleito.e : [];
    const federal = elections.find(e => /Federal/i.test(e.nm || '') && String(e.t) === '1');
    const estadual = elections.find(e => /Estadual/i.test(e.nm || '') && String(e.t) === '1');
    if (!federal || !estadual) return null;

    return {
      cycle: pleito.c || 'ele2026',
      federalElection: String(federal.cd),
      stateElection: String(estadual.cd)
    };
  }

  async function loadConfig() {
    try {
      const config = await fetchJson(CONFIG_URL);
      const parsed = extract2026Config(config);
      if (parsed) Object.assign(state, parsed);
    } catch (err) {
      console.warn('Configuração dinâmica indisponível; usando códigos oficiais de fallback.', err);
    }
  }

  function setConnection(kind, text) {
    els.liveChip.classList.remove('ok', 'error');
    if (kind) els.liveChip.classList.add(kind);
    els.liveText.textContent = text;
  }

  function candidateArray(data) {
    return Array.isArray(data?.cand) ? data.cand : [];
  }

  function candidateSort(a, b) {
    const va = Number(String(a?.vap ?? '').replace(/\D/g, '')) || 0;
    const vb = Number(String(b?.vap ?? '').replace(/\D/g, '')) || 0;
    if (vb !== va) return vb - va;
    return Number(a?.seq || 9999) - Number(b?.seq || 9999);
  }

  function isElected(c) {
    return String(c?.e || '').toLowerCase() === 's';
  }

  function partyLabel(c) {
    const raw = String(c?.cc || '').trim();
    return raw || 'Partido não informado';
  }

  function candidateCard(c, index) {
    const card = document.createElement('div');
    card.className = 'candidate-card';

    const rank = document.createElement('div');
    rank.className = 'rank';
    rank.textContent = `${index + 1}º`;

    const info = document.createElement('div');
    info.className = 'candidate-info';
    const name = document.createElement('div');
    name.className = 'candidate-name';
    const strong = document.createElement('strong');
    strong.textContent = c?.nm || 'Nome não informado';
    name.appendChild(strong);
    if (isElected(c)) {
      const badge = document.createElement('span');
      badge.className = 'elected-badge';
      badge.textContent = 'eleito';
      name.appendChild(badge);
    }
    const meta = document.createElement('div');
    meta.className = 'candidate-meta';
    const number = c?.n ? `Nº ${c.n}` : 'Nº —';
    meta.textContent = `${number} • ${partyLabel(c)}`;
    info.append(name, meta);

    const value = document.createElement('div');
    value.className = 'candidate-value';
    const pct = document.createElement('strong');
    pct.textContent = formatPercent(c?.pvap);
    const votes = document.createElement('span');
    votes.textContent = `${formatVotes(c?.vap)} votos`;
    value.append(pct, votes);

    card.append(rank, info, value);
    return card;
  }

  function renderCandidates(container, candidates, limit = Infinity) {
    container.replaceChildren();
    const sorted = [...candidates].sort(candidateSort);
    const visible = sorted.slice(0, limit);
    if (!visible.length) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'Nenhum candidato disponível neste arquivo ainda.';
      container.appendChild(empty);
      return;
    }
    visible.forEach((c, index) => container.appendChild(candidateCard(c, index)));
  }

  function resultTimestamp(data) {
    const dt = String(data?.dt || '').trim();
    const ht = String(data?.ht || '').trim();
    return [dt, ht].filter(Boolean).join(' • ') || 'horário não informado';
  }

  function renderPresident(data) {
    const candidates = candidateArray(data);
    renderCandidates(els.presidentList, candidates, Infinity);

    const progress = normalizePercent(data?.pst);
    els.presProgressText.textContent = formatPercent(progress);
    els.presProgressBar.style.width = `${Math.max(0, Math.min(100, progress ?? 0))}%`;
    els.presFoot.textContent = `Arquivo do TSE atualizado em ${resultTimestamp(data)} • ${candidates.length} candidatura(s) no resultado.`;
  }

  function officeId(uf, office) { return `${uf}-${office.key}`; }

  function createOfficeCard(uf, office) {
    const fragment = els.officeTemplate.content.cloneNode(true);
    const root = fragment.querySelector('.office-card');
    root.dataset.officeId = officeId(uf, office);
    fragment.querySelector('.office-kicker').textContent = office.kicker;
    fragment.querySelector('.office-title').textContent = office.label;
    fragment.querySelector('.office-progress').textContent = 'carregando…';
    fragment.querySelector('.office-list').innerHTML = '<div class="skeleton-card"></div><div class="skeleton-card"></div>';
    fragment.querySelector('.show-more').hidden = true;
    fragment.querySelector('.office-foot').textContent = 'Aguardando o TSE…';
    return fragment;
  }

  function mountOfficeCards() {
    OFFICES.forEach(o => els.scOffices.appendChild(createOfficeCard('sc', o)));
    OFFICES.forEach(o => els.prOffices.appendChild(createOfficeCard('pr', o)));

    document.querySelectorAll('.office-card').forEach(card => {
      const input = card.querySelector('.candidate-search');
      const btn = card.querySelector('.show-more');
      input.addEventListener('input', () => renderOfficeFromState(card.dataset.officeId));
      btn.addEventListener('click', () => {
        const entry = state.offices.get(card.dataset.officeId);
        if (!entry) return;
        entry.expanded = !entry.expanded;
        renderOfficeFromState(card.dataset.officeId);
      });
    });
  }

  function renderOfficeFromState(id) {
    const card = document.querySelector(`[data-office-id="${CSS.escape(id)}"]`);
    const entry = state.offices.get(id);
    if (!card || !entry) return;

    const input = card.querySelector('.candidate-search');
    const list = card.querySelector('.office-list');
    const more = card.querySelector('.show-more');
    const query = input.value.trim().toLocaleLowerCase('pt-BR');
    let candidates = candidateArray(entry.data).sort(candidateSort);

    if (query) {
      candidates = candidates.filter(c => [c?.nm, c?.cc, c?.n]
        .some(v => String(v ?? '').toLocaleLowerCase('pt-BR').includes(query)));
    }

    const showAll = entry.expanded || !!query;
    const limit = showAll ? Infinity : DEFAULT_VISIBLE;
    renderCandidates(list, candidates, limit);

    const total = candidates.length;
    more.hidden = !!query || total <= DEFAULT_VISIBLE;
    if (!more.hidden) {
      more.textContent = entry.expanded
        ? 'Mostrar menos'
        : `Ver todos (${total})`;
    }
  }

  function renderOffice(uf, office, data) {
    const id = officeId(uf, office);
    const previous = state.offices.get(id);
    state.offices.set(id, { data, expanded: previous?.expanded || false });

    const card = document.querySelector(`[data-office-id="${CSS.escape(id)}"]`);
    if (!card) return;
    const progress = normalizePercent(data?.pst);
    card.querySelector('.office-progress').textContent = `${formatPercent(progress)} das seções`;
    card.querySelector('.office-foot').textContent = `TSE: ${resultTimestamp(data)} • ${candidateArray(data).length} candidatura(s).`;
    renderOfficeFromState(id);
  }

  function renderOfficeError(uf, office, err) {
    const id = officeId(uf, office);
    const card = document.querySelector(`[data-office-id="${CSS.escape(id)}"]`);
    if (!card) return;
    card.querySelector('.office-progress').textContent = 'indisponível';
    card.querySelector('.office-list').innerHTML = '<div class="error-box">Não foi possível ler este resultado agora. Tentaremos novamente automaticamente.</div>';
    card.querySelector('.show-more').hidden = true;
    card.querySelector('.office-foot').textContent = `Falha temporária: ${err?.message || 'erro desconhecido'}`;
  }

  async function refreshAll({ manual = false } = {}) {
    if (state.refreshing) return;
    state.refreshing = true;
    els.refreshBtn.disabled = true;
    if (manual) setConnection('', 'atualizando…');

    const jobs = [];
    jobs.push({ type: 'president', promise: fetchJson(resultUrl('br', 1, state.federalElection)) });
    for (const uf of ['sc', 'pr']) {
      for (const office of OFFICES) {
        jobs.push({ uf, office, promise: fetchJson(resultUrl(uf, office.code, state.stateElection)) });
      }
    }

    const results = await Promise.allSettled(jobs.map(j => j.promise));
    let successes = 0;
    let failures = 0;

    results.forEach((r, i) => {
      const job = jobs[i];
      if (r.status === 'fulfilled') {
        successes += 1;
        if (job.type === 'president') renderPresident(r.value);
        else renderOffice(job.uf, job.office, r.value);
      } else {
        failures += 1;
        console.warn('Falha de atualização', job, r.reason);
        if (job.type === 'president') {
          if (!state.firstSuccess) {
            els.presidentList.innerHTML = '<div class="error-box">Não foi possível ler o resultado presidencial agora. Tentaremos novamente automaticamente.</div>';
          }
          els.presFoot.textContent = `Falha temporária: ${r.reason?.message || 'erro desconhecido'}`;
        } else {
          renderOfficeError(job.uf, job.office, r.reason);
        }
      }
    });

    const now = new Date();
    els.lastRead.textContent = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    els.footerStatus.textContent = `${successes}/9 arquivos lidos • ${now.toLocaleTimeString('pt-BR')}`;

    if (successes > 0) {
      state.firstSuccess = true;
      setConnection(failures ? '' : 'ok', failures ? `${successes}/9 arquivos online` : 'ao vivo • TSE');
    } else {
      setConnection('error', 'TSE indisponível');
    }

    state.refreshing = false;
    els.refreshBtn.disabled = false;
  }

  async function init() {
    mountOfficeCards();
    els.refreshBtn.addEventListener('click', () => refreshAll({ manual: true }));
    await loadConfig();
    await refreshAll();
    state.timer = setInterval(refreshAll, POLL_MS);

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        clearInterval(state.timer);
        state.timer = null;
      } else {
        refreshAll();
        if (!state.timer) state.timer = setInterval(refreshAll, POLL_MS);
      }
    });
  }

  init().catch(err => {
    console.error(err);
    setConnection('error', 'erro ao iniciar');
    els.footerStatus.textContent = 'O painel encontrou um erro ao iniciar.';
  });
})();
