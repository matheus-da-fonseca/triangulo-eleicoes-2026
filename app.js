(() => {
  'use strict';

  const TSE_BASE = 'https://resultados.tse.jus.br/oficial';
  const CONFIG_URL = `${TSE_BASE}/comum/config/ele-c.json`;
  const POLL_MS = 1_000;
  const REQUEST_TIMEOUT_MS = 8_000;
  const DEPLOY_WATCH_MS = 15_000;
  const MAP_POLL_MS = 2_000;
  const DEFAULT_VISIBLE = 6;

  const MAP_UFS = [
    'ac','al','ap','am','ba','ce','df','es','go','ma','mt','ms','mg',
    'pa','pb','pr','pe','pi','rj','rn','rs','ro','rr','sc','sp','se','to'
  ];

  const MAP_PALETTE = [
    '#ff54d8','#8b7cff','#46d9ff','#ff9f43','#55e6a5',
    '#ff6b78','#ffd166','#7ed957','#c778ff','#52b7ff'
  ];

  // Comparativo visual de 2022: preenchimento estático conforme o mapa de referência
  // fornecido para o projeto. Não faz requests aos endpoints históricos do TSE.
  const MAP_2022 = {
    lula: new Set(['am','pa','to','ma','pi','ce','rn','pb','pe','al','se','ba','mg']),
    bolsonaro: new Set(['rr','ap','ac','ro','mt','go','df','ms','sp','pr','sc','rs','rj','es'])
  };

  const MAP_2022_COLORS = {
    lula: '#D62828',
    bolsonaro: '#103B73'
  };

  const PRESIDENT_VICES_2026 = [
    [['LULA', 'LUIZ INACIO LULA'], 'Geraldo Alckmin'],
    [['FLAVIO BOLSONARO'], 'Alfredo Gaspar'],
    [['RONALDO CAIADO'], 'Gilberto Kassab'],
    [['RUI COSTA PIMENTA'], 'Antônio Carlos'],
    [['SAMARA'], 'Raquel Brício'],
    [['ROMEU ZEMA'], 'Eduardo Girão'],
    [['HERTZ DIAS'], 'Vanessa Portugal'],
    [['EDMILSON COSTA'], 'Cleusa Santos'],
    [['RENAN SANTOS'], 'Aroldo Medina'],
    [['WILSON GRASSI'], 'Suêd Haidar'],
    [['CLARIANA BARAO'], 'Fabiana Torquato'],
    [['AUGUSTO CURY', 'ESCRITOR AUGUSTO CURY'], 'Júlio Delgado']
  ];

  const FALLBACK = {
    cycle: 'ele2026',
    federalElection: '6257',
    stateElection: '6259'
  };

  const OFFICES = [
    { code: 3, key: 'governador', label: 'Governador', kicker: 'EXECUTIVO ESTADUAL', vacancies: { sc: 1, pr: 1 } },
    { code: 5, key: 'senador', label: 'Senador', kicker: 'SENADO', vacancies: { sc: 2, pr: 2 } },
    { code: 6, key: 'dep-federal', label: 'Deputado Federal', kicker: 'CÂMARA DOS DEPUTADOS', vacancies: { sc: 16, pr: 30 } },
    { code: 7, key: 'dep-estadual', label: 'Deputado Estadual', kicker: 'ASSEMBLEIA LEGISLATIVA', vacancies: { sc: 40, pr: 54 } }
  ];

  const state = {
    cycle: FALLBACK.cycle,
    federalElection: FALLBACK.federalElection,
    stateElection: FALLBACK.stateElection,
    refreshing: false,
    timer: null,
    firstSuccess: false,
    lastPollAt: null,
    ageTimer: null,
    deployTimer: null,
    deploySignature: null,
    mapTimer: null,
    mapMode: 'leader',
    mapYear: '2026',
    mapGeo: null,
    mapData: new Map(),
    mapData2022: new Map(),
    mapSignatures: new Map(),
    map2022Loaded: true,
    map2022Loading: false,
    mapLastUpdatedAt: null,
    nationalProgress2026: 0,
    nationalCandidates: [],
    selectedMapUf: null,
    resultSignatures: new Map(),
    offices: new Map()
  };

  const els = {
    liveChip: document.querySelector('#liveChip'),
    liveText: document.querySelector('#liveText'),
    tseDataTime: document.querySelector('#tseDataTime'),
    lastRead: document.querySelector('#lastRead'),
    presidentFaceoff: document.querySelector('#presidentFaceoff'),
    presidentRanking: document.querySelector('#presidentRanking'),
    presidencyMap: document.querySelector('#presidencyMap'),
    mapTooltip: document.querySelector('#mapTooltip'),
    mapStateDetail: document.querySelector('#mapStateDetail'),
    mapLegend: document.querySelector('#mapLegend'),
    mapStatus: document.querySelector('#mapStatus'),
    mapSource: document.querySelector('#mapSource'),
    mapNationalProgressLabel: document.querySelector('#mapNationalProgressLabel'),
    mapNationalProgressText: document.querySelector('#mapNationalProgressText'),
    mapNationalProgressBar: document.querySelector('#mapNationalProgressBar'),
    presProgressText: document.querySelector('#presProgressText'),
    presSituation: document.querySelector('#presSituation'),
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

  function voteNumber(value) {
    if (value === null || value === undefined || value === '') return 0;
    const digits = String(value).replace(/\D/g, '');
    const n = Number(digits);
    return Number.isFinite(n) ? n : 0;
  }

  function formatVotes(value) {
    if (value === null || value === undefined || value === '') return '—';
    const n = voteNumber(value);
    return n.toLocaleString('pt-BR');
  }

  function padElection(code) {
    return String(code).padStart(6, '0');
  }

  function resultUrl(uf, cargoCode, electionCode) {
    const e = padElection(electionCode);
    return `${TSE_BASE}/${state.cycle}/${electionCode}/dados/${uf}/${uf}-c${String(cargoCode).padStart(4, '0')}-e${e}-u.json`;
  }

  function photoUrl(c, uf, electionCode) {
    const sqcand = String(c?.sqcand || '').trim();
    if (!sqcand) return '';
    return `${TSE_BASE}/${state.cycle}/${electionCode}/fotos/${uf}/${sqcand}.jpeg`;
  }

  function candidateDisplayName(c) {
    return String(c?.nmu || c?.nm || 'Nome não informado').trim();
  }

  function vicePresidentName(c) {
    const normalized = candidateDisplayName(c)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase();

    const match = PRESIDENT_VICES_2026.find(([aliases]) =>
      aliases.some(alias => normalized === alias || normalized.includes(alias))
    );

    return match?.[1] || '';
  }

  function candidateInitials(c) {
    const parts = candidateDisplayName(c).split(/\s+/).filter(Boolean);
    return (parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : parts[0]?.slice(0, 2) || '?').toUpperCase();
  }

  function candidatePhoto(c, context, extraClass = '') {
    const wrap = document.createElement('div');
    wrap.className = `candidate-photo ${extraClass}`.trim();

    const fallback = document.createElement('span');
    fallback.className = 'candidate-photo-fallback';
    fallback.textContent = candidateInitials(c);
    wrap.appendChild(fallback);

    const src = photoUrl(c, context?.uf || 'br', context?.electionCode || state.stateElection);
    if (src) {
      const img = document.createElement('img');
      img.alt = `Foto de ${candidateDisplayName(c)}`;
      img.loading = 'lazy';
      img.decoding = 'async';
      img.src = src;
      img.addEventListener('load', () => fallback.setAttribute('hidden', ''));
      img.addEventListener('error', () => img.remove());
      wrap.appendChild(img);
    }
    return wrap;
  }

  function fastHash(text) {
    let hash = 2166136261;
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16);
  }

  async function assetFingerprint(path) {
    const url = new URL(path, location.href);
    url.searchParams.set('__check', Date.now().toString());

    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status} em ${path}`);

    const text = await response.text();
    const etag = response.headers.get('etag') || '';
    const modified = response.headers.get('last-modified') || '';
    return `${etag}|${modified}|${text.length}|${fastHash(text)}`;
  }

  async function deploymentSignature() {
    const paths = ['./index.html', './app.js', './styles.css'];
    const fingerprints = await Promise.all(paths.map(assetFingerprint));
    return fingerprints.join('::');
  }

  function reloadForNewDeployment() {
    try {
      sessionStorage.setItem('triangulo-scroll-y', String(window.scrollY));
    } catch (_) {}

    const nextUrl = new URL(location.href);
    nextUrl.searchParams.set('__deploy', Date.now().toString());
    location.replace(nextUrl.toString());
  }

  async function watchDeployment() {
    if (document.hidden) return;

    try {
      const signature = await deploymentSignature();
      if (!state.deploySignature) {
        state.deploySignature = signature;
        return;
      }

      if (signature !== state.deploySignature) {
        reloadForNewDeployment();
      }
    } catch (err) {
      console.warn('Não foi possível verificar uma nova versão do site.', err);
    }
  }

  function restoreScrollAfterDeployment() {
    try {
      const stored = sessionStorage.getItem('triangulo-scroll-y');
      if (stored === null) return;
      sessionStorage.removeItem('triangulo-scroll-y');
      const y = Number(stored);
      if (Number.isFinite(y)) requestAnimationFrame(() => window.scrollTo(0, y));
    } catch (_) {}
  }

  function candidateKey(c) {
    return String(c?.sqcand || c?.n || candidateDisplayName(c));
  }

  function normalizedCandidateName(c) {
    return candidateDisplayName(c)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase();
  }

  function candidateMapColor(c) {
    const name = normalizedCandidateName(c);

    if (name.includes('FLAVIO BOLSONARO') || name.includes('JAIR BOLSONARO')) return '#103B73';
    if (name === 'LULA' || name.includes('LUIZ INACIO LULA')) return '#D62828';

    const key = candidateKey(c);
    const index = state.nationalCandidates.findIndex(n => candidateKey(n) === key);
    if (index >= 0) return MAP_PALETTE[index % MAP_PALETTE.length];

    let hash = 0;
    for (let i = 0; i < key.length; i += 1) hash = ((hash << 5) - hash + key.charCodeAt(i)) | 0;
    return MAP_PALETTE[Math.abs(hash) % MAP_PALETTE.length];
  }

  function geometryPoints(geometry) {
    if (!geometry) return [];
    if (geometry.type === 'Polygon') return geometry.coordinates.flat();
    if (geometry.type === 'MultiPolygon') return geometry.coordinates.flat(2);
    return [];
  }

  function geoBounds(features) {
    const pts = features.flatMap(f => geometryPoints(f.geometry));
    const xs = pts.map(p => p[0]);
    const ys = pts.map(p => p[1]);
    return {
      minX: Math.min(...xs), maxX: Math.max(...xs),
      minY: Math.min(...ys), maxY: Math.max(...ys)
    };
  }

  function projectPoint(point, bounds, width = 620, height = 600, pad = 24) {
    const spanX = bounds.maxX - bounds.minX;
    const spanY = bounds.maxY - bounds.minY;
    const scale = Math.min((width - pad * 2) / spanX, (height - pad * 2) / spanY);
    const drawW = spanX * scale;
    const drawH = spanY * scale;
    const ox = (width - drawW) / 2;
    const oy = (height - drawH) / 2;
    return [
      ox + (point[0] - bounds.minX) * scale,
      height - (oy + (point[1] - bounds.minY) * scale)
    ];
  }

  function ringPath(ring, bounds) {
    if (!ring?.length) return '';
    return ring.map((p, i) => {
      const [x, y] = projectPoint(p, bounds);
      return `${i ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`;
    }).join(' ') + ' Z';
  }

  function geometryPath(geometry, bounds) {
    if (!geometry) return '';
    if (geometry.type === 'Polygon') {
      return geometry.coordinates.map(r => ringPath(r, bounds)).join(' ');
    }
    if (geometry.type === 'MultiPolygon') {
      return geometry.coordinates.flatMap(poly => poly.map(r => ringPath(r, bounds))).join(' ');
    }
    return '';
  }

  function featureCenter(feature, bounds) {
    const pts = geometryPoints(feature.geometry);
    if (!pts.length) return [0, 0];
    const minX = Math.min(...pts.map(p => p[0]));
    const maxX = Math.max(...pts.map(p => p[0]));
    const minY = Math.min(...pts.map(p => p[1]));
    const maxY = Math.max(...pts.map(p => p[1]));
    return projectPoint([(minX + maxX) / 2, (minY + maxY) / 2], bounds);
  }

  function statePresidentSummary(data) {
    const candidates = candidateArray(data).sort(candidateSort);
    const leader = candidates[0] || null;
    const second = candidates[1] || null;
    return {
      candidates,
      leader,
      second,
      diff: Math.abs(voteNumber(leader?.vap) - voteNumber(second?.vap)),
      progress: totalizationPercent(data) ?? 0,
      timestamp: totalizationTimestamp(data)
    };
  }

  function historical2022Winner(uf) {
    if (MAP_2022.lula.has(uf)) return 'lula';
    if (MAP_2022.bolsonaro.has(uf)) return 'bolsonaro';
    return '';
  }

  function buildStaticMap2022() {
    if (state.mapData2022.size) return;

    MAP_UFS.forEach(uf => {
      const winner = historical2022Winner(uf);
      if (!winner) return;

      state.mapData2022.set(uf, {
        historical: true,
        winner,
        leader: {
          nmu: winner === 'lula' ? 'LULA' : 'BOLSONARO',
          nm: winner === 'lula' ? 'LULA' : 'BOLSONARO',
          vap: '1'
        },
        progress: 100,
        timestamp: '2º turno de 2022'
      });
    });
  }

  function activeMapData() {
    return state.mapYear === '2022' ? state.mapData2022 : state.mapData;
  }

  function activeMapSummary(uf) {
    return activeMapData().get(uf);
  }

  function updateMapNationalProgress() {
    if (!els.mapNationalProgressLabel || !els.mapNationalProgressText || !els.mapNationalProgressBar) return;

    if (state.mapYear === '2022') {
      els.mapNationalProgressLabel.textContent = 'Mapa final por UF • 2022';
      els.mapNationalProgressText.textContent = '2º turno';
      els.mapNationalProgressBar.style.width = '100%';
      return;
    }

    const progress = Math.max(0, Math.min(100, state.nationalProgress2026 || 0));
    els.mapNationalProgressLabel.textContent = 'Apuração nacional • 2026';
    els.mapNationalProgressText.textContent = formatPercent(progress);
    els.mapNationalProgressBar.style.width = `${progress}%`;
  }

  function updateMapStatus() {
    if (!els.mapStatus) return;

    if (state.mapYear === '2022') {
      els.mapStatus.textContent = 'Comparativo visual de 2022 • vencedor por UF';
      if (els.mapSource) els.mapSource.textContent = 'Malha geográfica: IBGE • mapa 2022: referência visual histórica';
      return;
    }

    if (els.mapSource) els.mapSource.textContent = 'Malha geográfica: IBGE • dados eleitorais: TSE';

    if (state.mapLastUpdatedAt) {
      els.mapStatus.textContent = `27 UFs • consulta ${new Date(state.mapLastUpdatedAt).toLocaleTimeString('pt-BR')} • atualização a cada 2s`;
    } else {
      els.mapStatus.textContent = 'Carregando resultados de 2026 por UF…';
    }
  }

  function progressFill(progress) {
    const p = Math.max(0, Math.min(100, Number(progress) || 0));
    const light = 16 + (p / 100) * 48;
    return `hsl(286 72% ${light.toFixed(1)}%)`;
  }

  function mapStateFill(uf) {
    const summary = activeMapSummary(uf);
    if (!summary) return '#23152c';

    if (state.mapYear === '2022') {
      return summary.winner === 'lula'
        ? MAP_2022_COLORS.lula
        : MAP_2022_COLORS.bolsonaro;
    }

    if (state.mapMode === 'progress') return progressFill(summary.progress);
    if (!summary.leader || voteNumber(summary.leader?.vap) === 0) return '#2b1b34';
    return candidateMapColor(summary.leader);
  }

  function stateMapHtml(uf) {
    const summary = activeMapSummary(uf);
    const feature = state.mapGeo?.features?.find(f => String(f.properties?.sigla || '').toLowerCase() === uf);
    const name = feature?.properties?.nome || uf.toUpperCase();

    if (!summary) {
      return `<span class="map-detail-kicker">${name.toUpperCase()}</span><strong>Aguardando dados</strong><p>O resultado desta UF ainda não foi carregado.</p>`;
    }

    const leaderName = summary.leader ? candidateDisplayName(summary.leader) : '—';
    const historical = state.mapYear === '2022';

    if (historical) {
      return `
        <span class="map-detail-kicker">${name.toUpperCase()} • ${uf.toUpperCase()} • 2022 FINAL</span>
        <strong>${leaderName}</strong>
        <div class="map-detail-historical">Venceu nesta UF</div>
        <div class="map-detail-row"><span>Eleição</span><b>2º turno • 2022</b></div>
        <div class="map-detail-row"><span>Comparativo</span><b>Mapa histórico por vencedor em cada UF</b></div>
      `;
    }

    const secondName = summary.second ? candidateDisplayName(summary.second) : '—';
    return `
      <span class="map-detail-kicker">${name.toUpperCase()} • ${uf.toUpperCase()} • 2026 AO VIVO</span>
      <strong>${leaderName}</strong>
      <div class="map-detail-percent">${formatPercent(summary.leader?.pvap)}</div>
      <div class="map-detail-row"><span>2º colocado</span><b>${secondName} • ${formatPercent(summary.second?.pvap)}</b></div>
      <div class="map-detail-row"><span>Diferença</span><b>${summary.diff.toLocaleString('pt-BR')} votos</b></div>
      <div class="map-detail-row"><span>Seções totalizadas</span><b>${formatPercent(summary.progress)}</b></div>
      <div class="map-detail-row"><span>Última totalização</span><b>${summary.timestamp}</b></div>
    `;
  }

  function showMapDetail(uf) {
    state.selectedMapUf = uf;
    els.mapStateDetail.innerHTML = stateMapHtml(uf);
    document.querySelectorAll('.map-state').forEach(path => {
      path.classList.toggle('selected', path.dataset.uf === uf);
    });
  }

  function positionMapTooltip(event, uf) {
    if (!els.mapTooltip) return;
    const summary = activeMapSummary(uf);
    const feature = state.mapGeo?.features?.find(f => String(f.properties?.sigla || '').toLowerCase() === uf);
    const name = feature?.properties?.nome || uf.toUpperCase();
    const leader = summary?.leader ? candidateDisplayName(summary.leader) : 'Aguardando dados';

    if (state.mapYear === '2022') {
      els.mapTooltip.innerHTML = `<strong>${name} • 2022</strong><span>Vencedor na UF</span><b>${leader}</b><small>Mapa final do 2º turno</small>`;
    } else if (state.mapMode === 'progress') {
      els.mapTooltip.innerHTML = `<strong>${name}</strong><span>Seções totalizadas</span><b>${formatPercent(summary?.progress)}</b><small>${leader} lidera com ${formatPercent(summary?.leader?.pvap)}</small>`;
    } else {
      els.mapTooltip.innerHTML = `<strong>${name}</strong><span>${leader}</span><b>${formatPercent(summary?.leader?.pvap)} dos votos</b><small>Apuração: ${formatPercent(summary?.progress)} das seções</small>`;
    }
    els.mapTooltip.hidden = false;

    const wrap = els.mapTooltip.parentElement.getBoundingClientRect();
    const x = Math.min(wrap.width - 170, Math.max(8, event.clientX - wrap.left + 12));
    const y = Math.min(wrap.height - 105, Math.max(8, event.clientY - wrap.top + 12));
    els.mapTooltip.style.left = `${x}px`;
    els.mapTooltip.style.top = `${y}px`;
  }

  function renderMapLegend() {
    if (!els.mapLegend) return;

    if (state.mapYear === '2022') {
      els.mapLegend.innerHTML = `
        <span class="legend-title">2022 • vencedor por UF</span>
        <span><i style="background:${MAP_2022_COLORS.lula}"></i>LULA • ${MAP_2022.lula.size} UFs</span>
        <span><i style="background:${MAP_2022_COLORS.bolsonaro}"></i>BOLSONARO • ${MAP_2022.bolsonaro.size} UFs</span>
      `;
      return;
    }

    if (state.mapMode === 'progress') {
      els.mapLegend.innerHTML = `
        <span class="legend-title">Seções totalizadas</span>
        <span><i style="background:${progressFill(10)}"></i>0–20%</span>
        <span><i style="background:${progressFill(35)}"></i>20–50%</span>
        <span><i style="background:${progressFill(65)}"></i>50–80%</span>
        <span><i style="background:${progressFill(95)}"></i>80–100%</span>
      `;
      return;
    }

    const counts = new Map();
    activeMapData().forEach(summary => {
      if (!summary?.leader || voteNumber(summary.leader?.vap) === 0) return;
      const key = candidateKey(summary.leader);
      if (!counts.has(key)) counts.set(key, { candidate: summary.leader, count: 0 });
      counts.get(key).count += 1;
    });

    const leaders = [...counts.values()].sort((a,b) => b.count - a.count);
    if (!leaders.length) {
      els.mapLegend.innerHTML = '<span class="legend-title">Liderança por UF</span><span>Aguardando votos</span>';
      return;
    }

    els.mapLegend.replaceChildren();
    const title = document.createElement('span');
    title.className = 'legend-title';
    title.textContent = state.mapYear === '2022'
      ? 'Resultado final de 2022 • vencedor por UF'
      : 'Cor = candidato que lidera na UF';
    els.mapLegend.appendChild(title);

    leaders.forEach(({candidate, count}) => {
      const item = document.createElement('span');
      const dot = document.createElement('i');
      dot.style.background = candidateMapColor(candidate);
      item.append(dot, document.createTextNode(`${candidateDisplayName(candidate)} • ${count} UF${count === 1 ? '' : 's'}`));
      els.mapLegend.appendChild(item);
    });
  }

  function updateMapVisuals() {
    document.querySelectorAll('.map-state').forEach(path => {
      const uf = path.dataset.uf;
      path.style.fill = mapStateFill(uf);
      const summary = activeMapSummary(uf);
      path.style.opacity = summary ? '0.96' : '0.55';
    });

    document.querySelectorAll('.map-label').forEach(label => {
      const summary = activeMapSummary(label.dataset.uf);
      label.style.opacity = summary ? '1' : '.55';

      const pct = label.querySelector('.map-label-progress');
      if (pct) {
        const showProgress = state.mapYear === '2026' && state.mapMode === 'progress';
        pct.textContent = showProgress
          ? (summary ? `${Math.round(summary.progress)}%` : '—')
          : '';
        pct.classList.toggle('hidden-value', !showProgress);
      }
    });

    renderMapLegend();
    updateMapNationalProgress();
    updateMapStatus();
    if (state.selectedMapUf) showMapDetail(state.selectedMapUf);
  }

  function loadPresidentialMap2022() {
    buildStaticMap2022();
    state.map2022Loaded = true;
    state.map2022Loading = false;
    if (state.mapYear === '2022') updateMapVisuals();
  }

  function setMapYear(year) {
    state.mapYear = year === '2022' ? '2022' : '2026';

    document.querySelectorAll('.map-year').forEach(button => {
      button.classList.toggle('active', button.dataset.mapYear === state.mapYear);
    });

    const progressButton = document.querySelector('[data-map-mode="progress"]');
    if (state.mapYear === '2022') {
      state.mapMode = 'leader';
      document.querySelectorAll('.map-mode').forEach(button => {
        button.classList.toggle('active', button.dataset.mapMode === 'leader');
      });
      if (progressButton) {
        progressButton.disabled = true;
        progressButton.title = 'O comparativo de 2022 usa o resultado final já totalizado.';
      }
      loadPresidentialMap2022();
    } else if (progressButton) {
      progressButton.disabled = false;
      progressButton.removeAttribute('title');
    }

    updateMapVisuals();
  }

  async function initPresidentialMap() {
    if (!els.presidencyMap) return;

    try {
      state.mapGeo = await fetchJson('./assets/br-states.geojson');
      buildStaticMap2022();
      const features = state.mapGeo?.features || [];
      const bounds = geoBounds(features);
      els.presidencyMap.replaceChildren();

      features.forEach(feature => {
        const uf = String(feature.properties?.sigla || '').toLowerCase();
        if (!uf) return;

        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', geometryPath(feature.geometry, bounds));
        path.setAttribute('class', 'map-state');
        path.setAttribute('tabindex', '0');
        path.setAttribute('role', 'button');
        path.setAttribute('aria-label', feature.properties?.nome || uf.toUpperCase());
        path.dataset.uf = uf;

        path.addEventListener('mouseenter', event => positionMapTooltip(event, uf));
        path.addEventListener('mousemove', event => positionMapTooltip(event, uf));
        path.addEventListener('mouseleave', () => { els.mapTooltip.hidden = true; });
        path.addEventListener('focus', () => showMapDetail(uf));
        path.addEventListener('click', () => showMapDetail(uf));

        els.presidencyMap.appendChild(path);

        const [cx, cy] = featureCenter(feature, bounds);
        const textEl = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        textEl.setAttribute('x', cx.toFixed(2));
        textEl.setAttribute('y', (cy - 4).toFixed(2));
        textEl.setAttribute('class', 'map-label');
        textEl.setAttribute('text-anchor', 'middle');
        textEl.dataset.uf = uf;

        const ufLine = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
        ufLine.setAttribute('x', cx.toFixed(2));
        ufLine.setAttribute('class', 'map-label-uf');
        ufLine.textContent = uf.toUpperCase();

        const pctLine = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
        pctLine.setAttribute('x', cx.toFixed(2));
        pctLine.setAttribute('dy', '11');
        pctLine.setAttribute('class', 'map-label-progress');
        pctLine.textContent = '—';

        textEl.append(ufLine, pctLine);
        textEl.addEventListener('click', () => showMapDetail(uf));
        els.presidencyMap.appendChild(textEl);
      });

      document.querySelectorAll('.map-year').forEach(button => {
        button.addEventListener('click', () => setMapYear(button.dataset.mapYear));
      });

      document.querySelectorAll('.map-mode').forEach(button => {
        button.addEventListener('click', () => {
          if (button.disabled || state.mapYear === '2022') return;
          state.mapMode = button.dataset.mapMode || 'leader';
          document.querySelectorAll('.map-mode').forEach(b => b.classList.toggle('active', b === button));
          updateMapVisuals();
        });
      });

      updateMapVisuals();
    } catch (err) {
      console.error('Falha ao inicializar o mapa presidencial.', err);
      els.mapStatus.textContent = 'Não foi possível carregar a malha do mapa.';
    }
  }

  async function refreshPresidentialMap() {
    if (!state.mapGeo || document.hidden) return;

    const requests = MAP_UFS.map(uf =>
      fetchJson(resultUrl(uf, 1, state.federalElection))
        .then(data => ({ uf, data }))
    );

    const results = await Promise.allSettled(requests);
    let ok = 0;
    let changed = false;

    results.forEach(result => {
      if (result.status !== 'fulfilled') return;
      ok += 1;
      const { uf, data } = result.value;
      const signature = resultSignature(data);
      if (state.mapSignatures.get(uf) === signature) return;

      state.mapSignatures.set(uf, signature);
      state.mapData.set(uf, statePresidentSummary(data));
      changed = true;
    });

    if (changed) updateMapVisuals();

    const now = new Date();
    state.mapLastUpdatedAt = now.getTime();
    if (state.mapYear === '2026') {
      els.mapStatus.textContent = `${ok}/27 UFs consultadas • ${now.toLocaleTimeString('pt-BR')} • atualização a cada 2s`;
    }
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
    // EA20 (2026): os candidatos não ficam na raiz.
    // Estrutura oficial: carg[] -> agr[] -> par[] -> cand[].
    // Mantemos também o fallback para um eventual formato simplificado.
    if (Array.isArray(data?.cand)) return data.cand;

    const out = [];
    const cargos = Array.isArray(data?.carg) ? data.carg : [];

    for (const cargo of cargos) {
      const agregacoes = Array.isArray(cargo?.agr) ? cargo.agr : [];

      for (const agr of agregacoes) {
        const partidos = Array.isArray(agr?.par) ? agr.par : [];

        for (const partido of partidos) {
          const candidatos = Array.isArray(partido?.cand) ? partido.cand : [];

          for (const candidato of candidatos) {
            out.push({
              ...candidato,
              _cargoCode: cargo?.cd,
              _cargoName: cargo?.nmn || cargo?.nmm || cargo?.nmf || '',
              _partySigla: partido?.sg || '',
              _partyName: partido?.nm || '',
              _partyNumber: partido?.n || '',
              _groupName: agr?.nm || '',
              _groupType: agr?.tp || ''
            });
          }
        }
      }
    }

    return out;
  }

  function totalizationPercent(data) {
    return normalizePercent(data?.s?.pst ?? data?.pst);
  }

  function resultSignature(data) {
    const candidates = candidateArray(data);
    const candidateState = candidates.map(c => [
      c?.sqcand ?? '',
      c?.vap ?? '',
      c?.pvap ?? '',
      c?.e ?? ''
    ].join(':')).join('|');

    return [
      data?.dt ?? '',
      data?.ht ?? '',
      data?.dg ?? '',
      data?.hg ?? '',
      data?.and ?? '',
      data?.s?.pst ?? data?.pst ?? '',
      data?.s?.psi ?? '',
      data?.s?.psn ?? '',
      candidateState
    ].join('::');
  }

  function jobKey(job) {
    return job.type === 'president'
      ? 'br-presidente'
      : `${job.uf}-${job.office.key}`;
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

  function totalValidCandidateVotes(candidates) {
    return candidates.reduce((sum, c) => sum + voteNumber(c?.vap), 0);
  }

  function executiveSituation(data) {
    const candidates = candidateArray(data).sort(candidateSort);
    const totalValid = totalValidCandidateVotes(candidates);
    const leaderVotes = voteNumber(candidates[0]?.vap);

    if (!totalValid || !leaderVotes) {
      return {
        type: 'waiting',
        text: 'Aguardando votos • 2º turno ocorre se ninguém obtiver maioria absoluta dos votos válidos'
      };
    }

    if (leaderVotes * 2 > totalValid) {
      return {
        type: 'majority',
        text: 'Maioria absoluta no recorte atual • sem 2º turno se este fosse o resultado final'
      };
    }

    return {
      type: 'runoff',
      text: 'Sem maioria absoluta no recorte atual • haveria 2º turno entre 1º e 2º se este fosse o resultado final'
    };
  }

  function officeSituation(office, data) {
    if (office.code === 3) return executiveSituation(data);

    if (office.code === 5) {
      const hasVotes = totalValidCandidateVotes(candidateArray(data)) > 0;
      return {
        type: hasVotes ? 'no-runoff' : 'waiting',
        text: hasVotes
          ? 'Sem 2º turno • os 2 mais votados ocupam as vagas no recorte atual'
          : 'Aguardando votos • 2 vagas • eleição por maioria relativa, sem 2º turno'
      };
    }

    return {
      type: 'proportional',
      text: 'Sem 2º turno • sistema proporcional • vagas dependem da votação do partido/federação e da votação nominal'
    };
  }

  function setSituation(element, situation) {
    if (!element || !situation) return;
    element.className = `election-situation status-${situation.type}`;
    element.textContent = situation.text;
  }

  function partyLabel(c) {
    const sigla = String(c?._partySigla || '').trim();
    const nome = String(c?._partyName || '').trim();
    if (sigla && nome) return `${sigla} • ${nome}`;
    return sigla || nome || 'Partido não informado';
  }

  function candidateCard(c, rankNumber, context) {
    const card = document.createElement('div');
    card.className = 'candidate-card';

    const vacancies = Number(context?.vacancies || 0);
    const insideVacancy = vacancies > 0 && rankNumber <= vacancies;

    if (insideVacancy) {
      card.classList.add('rank-in-vacancy');
      card.title = `Dentro das ${vacancies} primeiras posições do ranking nominal atual`;
    }

    if (context?.highlightTop && insideVacancy && rankNumber === 1) {
      card.classList.add('rank-leader');
    } else if (context?.highlightTop && insideVacancy && vacancies >= 2 && rankNumber === 2) {
      card.classList.add('rank-runnerup');
    }

    const rank = document.createElement('div');
    rank.className = 'rank';
    rank.textContent = `${rankNumber}º`;

    const photo = candidatePhoto(c, context);

    const info = document.createElement('div');
    info.className = 'candidate-info';
    const name = document.createElement('div');
    name.className = 'candidate-name';
    const strong = document.createElement('strong');
    strong.textContent = candidateDisplayName(c);
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

    const vice = context?.uf === 'br' ? vicePresidentName(c) : '';
    if (vice) {
      const viceEl = document.createElement('div');
      viceEl.className = 'candidate-vice';
      viceEl.textContent = `Vice: ${vice}`;
      info.append(name, viceEl, meta);
    } else {
      info.append(name, meta);
    }

    const value = document.createElement('div');
    value.className = 'candidate-value';
    const pct = document.createElement('strong');
    pct.textContent = formatPercent(c?.pvap);
    const votes = document.createElement('span');
    votes.textContent = `${formatVotes(c?.vap)} votos`;
    value.append(pct, votes);

    card.append(rank, photo, info, value);
    return card;
  }

  function renderCandidates(container, candidates, context, startRank = 1) {
    container.replaceChildren();
    const sorted = [...candidates].sort(candidateSort);
    if (!sorted.length) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'Nenhum candidato disponível neste arquivo ainda.';
      container.appendChild(empty);
      return;
    }
    sorted.forEach((c, index) => {
      const rankNumber = Number(c?._rank) || (startRank + index);
      container.appendChild(candidateCard(c, rankNumber, context));
    });
  }

  function faceoffCandidate(c, context, position) {
    const card = document.createElement('div');
    card.className = `faceoff-candidate ${position}`;

    const photo = candidatePhoto(c, context, 'faceoff-photo');
    const copy = document.createElement('div');
    copy.className = 'faceoff-copy';

    const label = document.createElement('span');
    label.className = 'faceoff-label';
    label.textContent = position === 'left' ? '1º colocado' : '2º colocado';

    const name = document.createElement('h3');
    name.className = 'faceoff-name';
    name.textContent = candidateDisplayName(c);

    const vice = vicePresidentName(c);
    const viceEl = document.createElement('div');
    viceEl.className = 'faceoff-vice';
    viceEl.textContent = vice ? `Vice: ${vice}` : '';

    const meta = document.createElement('div');
    meta.className = 'faceoff-meta';
    meta.textContent = `${c?.n ? `Nº ${c.n} • ` : ''}${partyLabel(c)}`;

    const value = document.createElement('div');
    value.className = 'faceoff-value';
    value.textContent = formatPercent(c?.pvap);

    const votes = document.createElement('div');
    votes.className = 'faceoff-votes';
    votes.textContent = `${formatVotes(c?.vap)} votos`;

    copy.append(label, name);
    if (vice) copy.appendChild(viceEl);
    copy.append(meta, value, votes);
    card.append(photo, copy);
    return card;
  }

  function renderFaceoff(candidates) {
    els.presidentFaceoff.replaceChildren();
    const sorted = [...candidates].sort(candidateSort);
    const context = { uf: 'br', electionCode: state.federalElection };

    if (!sorted.length) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'Nenhum candidato presidencial disponível ainda.';
      els.presidentFaceoff.appendChild(empty);
      return;
    }

    els.presidentFaceoff.appendChild(faceoffCandidate(sorted[0], context, 'left'));

    if (sorted[1]) {
      const center = document.createElement('div');
      center.className = 'faceoff-center';

      const vs = document.createElement('div');
      vs.className = 'faceoff-vs';
      vs.textContent = 'VS';

      const gap = document.createElement('div');
      gap.className = 'faceoff-gap';
      const diff = Math.abs(voteNumber(sorted[0]?.vap) - voteNumber(sorted[1]?.vap));
      gap.innerHTML = `<span>diferença</span><strong>${diff.toLocaleString('pt-BR')}</strong><small>votos</small>`;

      center.append(vs, gap);
      els.presidentFaceoff.append(center, faceoffCandidate(sorted[1], context, 'right'));
    }
  }

  function totalizationTimestamp(data) {
    const dt = String(data?.dt ?? '').trim();
    const ht = String(data?.ht ?? '').trim();

    if (dt || ht) return [dt, ht].filter(Boolean).join(' • ');

    const andamento = String(data?.and ?? '').toLowerCase();
    if (andamento === 'n') return 'aguardando totalização';
    return 'totalização ainda sem horário';
  }

  function generationTimestamp(data) {
    const dg = String(data?.dg ?? '').trim();
    const hg = String(data?.hg ?? '').trim();
    return [dg, hg].filter(Boolean).join(' • ') || 'geração não informada';
  }

  function updateReadAge() {
    if (state.refreshing) {
      els.lastRead.textContent = 'verificando…';
      return;
    }

    if (!state.lastPollAt) {
      els.lastRead.textContent = 'aguardando';
      return;
    }

    const elapsedMs = Math.max(0, Date.now() - state.lastPollAt);
    if (elapsedMs < 1000) {
      els.lastRead.textContent = 'agora';
      return;
    }

    const seconds = Math.floor(elapsedMs / 1000);
    els.lastRead.textContent = seconds < 60
      ? `${seconds}s atrás`
      : `${Math.floor(seconds / 60)}min atrás`;
  }

  function renderPresident(data) {
    const candidates = candidateArray(data).sort(candidateSort);
    state.nationalCandidates = candidates;
    renderFaceoff(candidates);

    const rest = candidates.slice(2);
    if (rest.length) {
      renderCandidates(
        els.presidentRanking,
        rest,
        { uf: 'br', electionCode: state.federalElection },
        3
      );
      els.presidentRanking.parentElement.hidden = false;
    } else {
      els.presidentRanking.replaceChildren();
      els.presidentRanking.parentElement.hidden = true;
    }

    els.tseDataTime.textContent = totalizationTimestamp(data);
    setSituation(els.presSituation, executiveSituation(data));
    updateMapVisuals();

    const progress = totalizationPercent(data);
    els.presProgressText.textContent = formatPercent(progress);
    els.presProgressBar.style.width = `${Math.max(0, Math.min(100, progress ?? 0))}%`;
    state.nationalProgress2026 = Math.max(0, Math.min(100, progress ?? 0));
    updateMapNationalProgress();
    els.presFoot.textContent = `Totalização TSE: ${totalizationTimestamp(data)} • arquivo gerado em ${generationTimestamp(data)} • ${candidates.length} candidatura(s) no resultado.`;
  }

  function officeId(uf, office) { return `${uf}-${office.key}`; }

  function createOfficeCard(uf, office) {
    const fragment = els.officeTemplate.content.cloneNode(true);
    const root = fragment.querySelector('.office-card');
    root.dataset.officeId = officeId(uf, office);
    const vacancies = Number(office.vacancies?.[uf] || 0);
    const vacancyLabel = vacancies === 1 ? '1 VAGA' : `${vacancies} VAGAS`;
    fragment.querySelector('.office-kicker').textContent = `${office.kicker} • ${vacancyLabel}`;
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
      btn.hidden = true;
      input.addEventListener('input', () => renderOfficeFromState(card.dataset.officeId));
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
    const rankedCandidates = candidateArray(entry.data)
      .sort(candidateSort)
      .map((c, index) => ({ ...c, _rank: index + 1 }));

    let candidates = rankedCandidates;

    if (query) {
      candidates = candidates.filter(c => [
        c?.nmu,
        c?.nm,
        c?._partySigla,
        c?._partyName,
        c?._groupName,
        c?.n
      ].some(v => String(v ?? '').toLocaleLowerCase('pt-BR').includes(query)));
    }

    renderCandidates(
      list,
      candidates,
      {
        uf: entry.uf,
        electionCode: state.stateElection,
        highlightTop: true,
        vacancies: Number(entry.office?.vacancies?.[entry.uf] || 0)
      },
      1
    );

    more.hidden = true;
  }

  function renderOffice(uf, office, data) {
    const id = officeId(uf, office);
    const previous = state.offices.get(id);
    state.offices.set(id, { data, uf, office, expanded: previous?.expanded || false });

    const card = document.querySelector(`[data-office-id="${CSS.escape(id)}"]`);
    if (!card) return;
    const progress = totalizationPercent(data);
    card.querySelector('.office-progress').textContent = `${formatPercent(progress)} das seções`;
    setSituation(card.querySelector('.office-situation'), officeSituation(office, data));
    const vacancies = Number(office.vacancies?.[uf] || 0);
    card.querySelector('.office-foot').textContent = `Totalização TSE: ${totalizationTimestamp(data)} • faixa colorida: top ${vacancies} do ranking nominal • ${candidateArray(data).length} candidatura(s).`;
    renderOfficeFromState(id);
  }

  function renderOfficeError(uf, office, err) {
    const id = officeId(uf, office);
    const card = document.querySelector(`[data-office-id="${CSS.escape(id)}"]`);
    if (!card) return;
    card.querySelector('.office-progress').textContent = 'indisponível';
    setSituation(card.querySelector('.office-situation'), { type: 'waiting', text: 'Situação temporariamente indisponível' });
    card.querySelector('.office-list').innerHTML = '<div class="error-box">Não foi possível ler este resultado agora. Tentaremos novamente automaticamente.</div>';
    card.querySelector('.show-more').hidden = true;
    card.querySelector('.office-foot').textContent = `Falha temporária: ${err?.message || 'erro desconhecido'}`;
  }

  async function refreshAll({ manual = false } = {}) {
    if (state.refreshing) return;
    state.refreshing = true;
    updateReadAge();
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

        const key = jobKey(job);
        const signature = resultSignature(r.value);
        const changed = state.resultSignatures.get(key) !== signature;

        if (changed) {
          state.resultSignatures.set(key, signature);
          if (job.type === 'president') renderPresident(r.value);
          else renderOffice(job.uf, job.office, r.value);
        }
      } else {
        failures += 1;
        console.warn('Falha de atualização', job, r.reason);
        if (job.type === 'president') {
          if (!state.firstSuccess) {
            els.presidentFaceoff.innerHTML = '<div class="error-box">Não foi possível ler o resultado presidencial agora. Tentaremos novamente automaticamente.</div>';
            els.presidentRanking.replaceChildren();
          }
          els.presFoot.textContent = `Falha temporária: ${r.reason?.message || 'erro desconhecido'}`;
        } else {
          renderOfficeError(job.uf, job.office, r.reason);
        }
      }
    });

    const now = new Date();
    state.lastPollAt = now.getTime();
    state.refreshing = false;
    updateReadAge();
    els.footerStatus.textContent = `${successes}/9 arquivos lidos • consulta ${now.toLocaleTimeString('pt-BR')}`;

    if (successes > 0) {
      state.firstSuccess = true;
      setConnection(failures ? '' : 'ok', failures ? `${successes}/9 arquivos online` : 'ao vivo • TSE');
    } else {
      setConnection('error', 'TSE indisponível');
    }
  }

  async function init() {
    mountOfficeCards();
    await loadConfig();
    await initPresidentialMap();
    await Promise.all([refreshAll(), refreshPresidentialMap()]);
    restoreScrollAfterDeployment();
    await watchDeployment();
    state.timer = setInterval(refreshAll, POLL_MS);
    state.ageTimer = setInterval(updateReadAge, 250);
    state.deployTimer = setInterval(watchDeployment, DEPLOY_WATCH_MS);
    state.mapTimer = setInterval(refreshPresidentialMap, MAP_POLL_MS);

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        clearInterval(state.timer);
        state.timer = null;
      } else {
        refreshAll();
        refreshPresidentialMap();
        watchDeployment();
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
