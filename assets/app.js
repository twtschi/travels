(() => {
  'use strict';

  const elements = {
    destinationSelect: document.getElementById('destination-select'),
    destinationEyebrow: document.getElementById('destination-eyebrow'),
    destinationTitle: document.getElementById('destination-title'),
    destinationSummary: document.getElementById('destination-summary'),
    destinationUpdated: document.getElementById('destination-updated'),
    themeNav: document.getElementById('theme-nav'),
    contentPanel: document.getElementById('content-panel'),
    themeLabel: document.getElementById('theme-label'),
    themeTitle: document.getElementById('theme-title'),
    themeIntro: document.getElementById('theme-intro'),
    dataStatus: document.getElementById('data-status'),
    cardGrid: document.getElementById('card-grid'),
    mapElement: document.getElementById('guide-map'),
    locationButton: document.getElementById('location-button'),
    mapFocusButton: document.getElementById('map-focus-button'),
    locationStatus: document.getElementById('location-status')
  };

  const cache = new Map();
  let destinations = [];
  let activeManifest = null;
  let activeThemeId = null;
  let requestVersion = 0;
  let guideMap = null;
  let markerLayer = null;
  let userMarker = null;
  let currentItems = [];
  let userLocation = null;
  let selectedItemId = null;
  const itemMarkers = new Map();

  const create = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  const fetchJson = async path => {
    if (cache.has(path)) return cache.get(path);
    const request = fetch(path, {headers: {'Accept': 'application/json'}})
      .then(response => {
        if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
        return response.json();
      });
    cache.set(path, request);
    try {
      return await request;
    } catch (error) {
      cache.delete(path);
      throw error;
    }
  };

  const validWebUrl = value => {
    try {
      const url = new URL(value);
      return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
    } catch {
      return null;
    }
  };

  const sourceTypeLabel = sourceType => ({official: '官方', social: '社群', review: '評論'}[sourceType] || '來源');

  const validLocation = locationData => (
    locationData &&
    Number.isFinite(locationData.lat) &&
    Number.isFinite(locationData.lng)
  );

  const distanceInKilometres = (from, to) => {
    const radians = degrees => degrees * Math.PI / 180;
    const earthRadius = 6371;
    const latitudeDelta = radians(to.lat - from.lat);
    const longitudeDelta = radians(to.lng - from.lng);
    const a = Math.sin(latitudeDelta / 2) ** 2 +
      Math.cos(radians(from.lat)) * Math.cos(radians(to.lat)) *
      Math.sin(longitudeDelta / 2) ** 2;
    return earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  };

  const formatDistance = kilometres => (
    kilometres < 1
      ? `${Math.round(kilometres * 1000)} 公尺`
      : `${kilometres < 10 ? kilometres.toFixed(1) : Math.round(kilometres)} 公里`
  );

  const renderSources = sources => {
    if (!Array.isArray(sources) || sources.length === 0) {
      return create('p', 'unverified', '尚未附可查核來源；此卡片不可視為已完成查核。');
    }

    const details = create('details', 'sources');
    const kinds = new Set(sources.map(source => source.sourceType));
    const summary = create('summary', '', `${sources.length} 筆來源 · ${[...kinds].map(sourceTypeLabel).join('／')}`);
    const list = create('ul', 'source-list');

    sources.forEach(source => {
      const item = create('li');
      const href = validWebUrl(source.url);
      const container = href ? create('a', 'source-link') : create('div', 'source-link');
      if (href) {
        container.href = href;
        container.target = '_blank';
        container.rel = 'noopener noreferrer';
      }

      const head = create('span', 'source-head');
      head.append(create('span', 'source-platform', source.platform || '未標示平台'));
      head.append(create('span', `source-kind ${source.sourceType || ''}`, sourceTypeLabel(source.sourceType)));
      container.append(head);
      container.append(create('span', 'source-title', source.title || '未命名來源'));
      if (source.capturedAt) container.append(create('span', 'source-date', `擷取／查核：${source.capturedAt}`));
      item.append(container);
      list.append(item);
    });

    details.append(summary, list);
    return details;
  };

  const renderCard = item => {
    const card = create('article', 'info-card');
    const top = create('div', 'card-top');
    const titleGroup = create('div');
    titleGroup.append(create('span', 'area', item.area || '未分類地區'));
    titleGroup.append(create('h3', '', item.title || '未命名項目'));
    top.append(titleGroup);
    if (userLocation && validLocation(item.location)) {
      const distance = formatDistance(distanceInKilometres(userLocation, item.location));
      const badge = create('span', 'distance-badge', distance);
      badge.append(create('span', 'distance-note', '直線距離'));
      top.append(badge);
    }
    card.append(top, create('p', 'summary', item.summary || '尚無摘要。'));

    if (Array.isArray(item.tags) && item.tags.length) {
      const tags = create('div', 'tags');
      item.tags.forEach(tag => tags.append(create('span', 'tag', tag)));
      card.append(tags);
    }

    if (Array.isArray(item.highlights) && item.highlights.length) {
      const highlights = create('ul', 'highlights');
      item.highlights.forEach(highlight => highlights.append(create('li', '', highlight)));
      card.append(highlights);
    }

    if (Array.isArray(item.meta) && item.meta.length) {
      const metaList = create('div', 'meta-list');
      item.meta.forEach(meta => {
        const metaItem = create('div', 'meta-item');
        metaItem.append(create('b', '', meta.label || '資訊'), create('span', '', meta.value || '待確認'));
        metaList.append(metaItem);
      });
      card.append(metaList);
    }

    card.append(renderSources(item.sources));
    return card;
  };

  const renderSelectionEmpty = (message = '從地圖點選一個標記，這裡才會顯示地點詳情。') => {
    const empty = create('div', 'selection-empty');
    empty.append(create('span', 'selection-kicker', '尚未選取地點'));
    empty.append(create('h3', '', '先在地圖上選一個圓點'));
    empty.append(create('p', '', message));
    elements.cardGrid.replaceChildren(empty);
  };

  const updateMarkerSelection = () => {
    itemMarkers.forEach((marker, itemId) => {
      const element = marker.getElement();
      if (element) element.classList.toggle('selected', itemId === selectedItemId);
    });
  };

  const renderSelectedItem = () => {
    const item = currentItems.find(candidate => candidate.id === selectedItemId);
    if (!item) {
      renderSelectionEmpty();
      return;
    }
    elements.cardGrid.replaceChildren(renderCard(item));
  };

  const selectItem = itemId => {
    const item = currentItems.find(candidate => candidate.id === itemId);
    if (!item) return;
    selectedItemId = itemId;
    renderSelectedItem();
    updateMarkerSelection();
    if (window.matchMedia('(max-width: 860px)').matches) {
      requestAnimationFrame(() => elements.contentPanel.scrollIntoView({behavior: 'smooth', block: 'start'}));
    }
  };

  const destinationMapSettings = () => {
    const center = activeManifest?.map?.center;
    return {
      center: Array.isArray(center) && center.length === 2 ? center : [22.162, 113.555],
      zoom: Number.isFinite(activeManifest?.map?.zoom) ? activeManifest.map.zoom : 12
    };
  };

  const ensureMap = () => {
    if (guideMap) return true;
    if (!window.L) {
      elements.locationStatus.textContent = '地圖元件載入失敗；主題內容仍可正常使用。';
      elements.locationButton.disabled = true;
      return false;
    }

    const settings = destinationMapSettings();
    guideMap = L.map(elements.mapElement, {scrollWheelZoom: false, keyboard: true}).setView(settings.center, settings.zoom);
    const setMapInputActive = active => {
      guideMap.scrollWheelZoom[active ? 'enable' : 'disable']();
      elements.mapElement.classList.toggle('map-input-active', active);
    };
    elements.mapElement.addEventListener('pointerdown', () => {
      elements.mapElement.focus({preventScroll: true});
      setMapInputActive(true);
    });
    elements.mapElement.addEventListener('focusin', () => setMapInputActive(true));
    elements.mapElement.addEventListener('focusout', event => {
      if (!elements.mapElement.contains(event.relatedTarget)) setMapInputActive(false);
    });
    elements.mapElement.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      setMapInputActive(false);
      document.activeElement?.blur();
    });
    document.addEventListener('pointerdown', event => {
      if (!elements.mapElement.contains(event.target)) setMapInputActive(false);
    });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap contributors'
    }).addTo(guideMap);
    markerLayer = L.layerGroup().addTo(guideMap);
    new ResizeObserver(() => guideMap.invalidateSize()).observe(elements.mapElement);
    return true;
  };

  const fitMap = includeUser => {
    if (!guideMap) return;
    const points = currentItems
      .filter(item => validLocation(item.location))
      .map(item => [item.location.lat, item.location.lng]);
    if (includeUser && userLocation) points.push([userLocation.lat, userLocation.lng]);

    if (points.length === 0) {
      const settings = destinationMapSettings();
      guideMap.setView(settings.center, settings.zoom);
    } else if (points.length === 1) {
      guideMap.setView(points[0], 14);
    } else {
      guideMap.fitBounds(L.latLngBounds(points).pad(0.18), {maxZoom: 14});
    }
  };

  const renderMap = (items, includeUser = false) => {
    if (!ensureMap()) return;
    markerLayer.clearLayers();
    itemMarkers.clear();
    selectedItemId = null;
    renderSelectionEmpty();
    const locatedItems = items.filter(item => validLocation(item.location));

    locatedItems.forEach(item => {
      const icon = L.divIcon({
        className: 'atlas-marker',
        html: '<span aria-hidden="true"></span>',
        iconSize: [30, 30],
        iconAnchor: [15, 15]
      });
      const marker = L.marker([item.location.lat, item.location.lng], {
        icon,
        title: item.title || '未命名地點',
        alt: `查看${item.title || '地點'}詳情`,
        keyboard: true,
        riseOnHover: true
      });
      marker.on('click', () => selectItem(item.id));
      marker.addTo(markerLayer);
      itemMarkers.set(item.id, marker);
    });

    if (userLocation) {
      if (!userMarker) {
        userMarker = L.circleMarker([userLocation.lat, userLocation.lng], {
          radius: 9,
          weight: 3,
          color: '#ffffff',
          fillColor: '#305f88',
          fillOpacity: 1
        }).bindPopup('你的位置').addTo(guideMap);
      } else {
        userMarker.setLatLng([userLocation.lat, userLocation.lng]);
      }
      elements.locationStatus.textContent = `已取得位置（精確度約 ${Math.round(userLocation.accuracy)} 公尺）；地圖上有 ${locatedItems.length} 個可點地點。距離皆為直線估算。`;
    } else {
      elements.locationStatus.textContent = `地圖上有 ${locatedItems.length} 個可點地點；點選標記查看詳情。`;
    }

    elements.mapFocusButton.disabled = locatedItems.length === 0;
    requestAnimationFrame(() => {
      guideMap.invalidateSize();
      fitMap(includeUser);
    });
  };

  const requestUserLocation = () => {
    if (!navigator.geolocation) {
      elements.locationStatus.textContent = '此瀏覽器不支援定位功能。';
      return;
    }

    elements.locationButton.disabled = true;
    elements.locationStatus.textContent = '正在等待瀏覽器定位授權…';
    navigator.geolocation.getCurrentPosition(position => {
      userLocation = {
        lat: position.coords.latitude,
        lng: position.coords.longitude,
        accuracy: position.coords.accuracy
      };
      elements.locationButton.disabled = false;
      elements.locationButton.textContent = '更新我的位置';
      const selectedBeforeUpdate = selectedItemId;
      renderMap(currentItems, true);
      if (selectedBeforeUpdate && itemMarkers.has(selectedBeforeUpdate)) {
        selectedItemId = selectedBeforeUpdate;
        renderSelectedItem();
        updateMarkerSelection();
      }
    }, error => {
      const messages = {
        1: '你拒絕了定位授權；仍可使用地圖瀏覽主題地點。',
        2: '目前無法取得位置；請確認裝置定位服務已開啟。',
        3: '定位逾時；請稍後再試。'
      };
      elements.locationStatus.textContent = messages[error.code] || '定位失敗；請稍後再試。';
      elements.locationButton.disabled = false;
    }, {
      enableHighAccuracy: false,
      timeout: 10000,
      maximumAge: 300000
    });
  };

  const setQuery = (destinationId, themeId, push) => {
    const url = new URL(location.href);
    url.searchParams.set('destination', destinationId);
    url.searchParams.set('theme', themeId);
    url.hash = '';
    history[push ? 'pushState' : 'replaceState']({destinationId, themeId}, '', url);
  };

  const setThemeButtonState = themeId => {
    elements.themeNav.querySelectorAll('.theme-button').forEach(button => {
      const active = button.dataset.theme === themeId;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
  };

  const loadTheme = async (themeId, {push = false} = {}) => {
    if (!activeManifest) return;
    const theme = activeManifest.themes.find(candidate => candidate.id === themeId) || activeManifest.themes[0];
    if (!theme) throw new Error('目的地沒有可用主題');

    const currentRequest = ++requestVersion;
    activeThemeId = theme.id;
    setThemeButtonState(theme.id);
    elements.contentPanel.setAttribute('aria-busy', 'true');
    elements.dataStatus.className = 'data-status';
    elements.dataStatus.textContent = `從 ${theme.data} 讀取地點…`;
    currentItems = [];
    selectedItemId = null;
    renderSelectionEmpty('主題載入中，地圖標記準備完成後即可點選。');
    if (push) setQuery(activeManifest.id, theme.id, true);

    try {
      const data = await fetchJson(theme.data);
      if (currentRequest !== requestVersion) return;
      if (!data.theme || !Array.isArray(data.items)) throw new Error('主題資料格式不正確');

      elements.themeLabel.textContent = data.theme.label || theme.label;
      elements.themeTitle.textContent = data.theme.title || theme.label;
      elements.themeIntro.textContent = data.theme.intro || theme.description;
      currentItems = data.items;
      renderMap(currentItems);

      const locatedCount = data.items.filter(item => validLocation(item.location)).length;
      const socialCount = data.items.reduce((count, item) => count + (Array.isArray(item.sources) ? item.sources.filter(source => source.sourceType === 'social').length : 0), 0);
      elements.dataStatus.textContent = `${locatedCount} 個可點地點 · ${socialCount} 筆社群來源 · 更新 ${data.updatedAt || '未標示'}`;
      setQuery(activeManifest.id, theme.id, false);
    } catch (error) {
      if (currentRequest !== requestVersion) return;
      elements.themeLabel.textContent = theme.label;
      elements.themeTitle.textContent = '資料載入失敗';
      elements.themeIntro.textContent = '請確認主題資料檔存在且 JSON 格式正確。';
      elements.dataStatus.className = 'data-status error';
      elements.dataStatus.textContent = `${theme.data}：${error.message}`;
      const retry = create('button', 'retry-button', '重試');
      retry.type = 'button';
      retry.addEventListener('click', () => loadTheme(theme.id));
      elements.dataStatus.append(retry);
    } finally {
      if (currentRequest === requestVersion) elements.contentPanel.setAttribute('aria-busy', 'false');
    }
  };

  const renderThemeNavigation = manifest => {
    const fragment = document.createDocumentFragment();
    manifest.themes.forEach(theme => {
      const button = create('button', 'theme-button');
      button.type = 'button';
      button.dataset.theme = theme.id;
      button.setAttribute('aria-pressed', 'false');
      button.append(document.createTextNode(theme.label));
      button.append(create('small', '', theme.description));
      button.addEventListener('click', () => loadTheme(theme.id, {push: true}));
      fragment.append(button);
    });
    elements.themeNav.replaceChildren(fragment);
  };

  const loadDestination = async (destinationId, requestedThemeId, {push = false} = {}) => {
    const destination = destinations.find(candidate => candidate.id === destinationId) || destinations[0];
    if (!destination) throw new Error('沒有已發布的目的地');

    elements.destinationSelect.value = destination.id;
    elements.destinationTitle.textContent = '讀取目的地資料…';
    elements.destinationSummary.textContent = destination.summary || '';
    elements.themeNav.replaceChildren();
    renderSelectionEmpty('正在載入目的地與地圖資料。');
    elements.dataStatus.textContent = `從 ${destination.manifest} 讀取資訊清單…`;

    const manifest = await fetchJson(destination.manifest);
    if (!Array.isArray(manifest.themes) || manifest.themes.length === 0) throw new Error('目的地資訊清單沒有主題');
    activeManifest = manifest;
    ensureMap();
    elements.destinationEyebrow.textContent = `${manifest.eyebrow || 'Destination guide'} · ${manifest.nameEn || manifest.id}`;
    elements.destinationTitle.textContent = manifest.headline || manifest.name;
    elements.destinationSummary.textContent = manifest.summary || destination.summary;
    elements.destinationUpdated.textContent = `目的地資料更新：${manifest.updatedAt || '未標示'}`;
    renderThemeNavigation(manifest);

    const themeId = manifest.themes.some(theme => theme.id === requestedThemeId) ? requestedThemeId : manifest.themes[0].id;
    if (push) setQuery(destination.id, themeId, true);
    await loadTheme(themeId);
  };

  const renderDestinationOptions = () => {
    const fragment = document.createDocumentFragment();
    destinations.forEach(destination => {
      const option = create('option', '', `${destination.name} ${destination.nameEn ? `· ${destination.nameEn}` : ''}`);
      option.value = destination.id;
      fragment.append(option);
    });
    elements.destinationSelect.replaceChildren(fragment);
    elements.destinationSelect.disabled = destinations.length < 2;
  };

  const showFatalError = error => {
    elements.destinationTitle.textContent = '平台資料載入失敗';
    elements.destinationSummary.textContent = '請確認 destinations.json 與目的地資訊清單存在且格式正確。';
    elements.dataStatus.className = 'data-status error';
    elements.dataStatus.textContent = error.message;
    elements.contentPanel.setAttribute('aria-busy', 'false');
  };

  const showFileProtocolHelp = () => {
    elements.destinationSelect.replaceChildren(create('option', '', '請先啟動本機伺服器'));
    elements.destinationTitle.textContent = '請透過 HTTP 開啟網站';
    elements.destinationSummary.textContent = '瀏覽器不允許 file:// 頁面讀取旁邊的 JSON，因此不能直接雙擊 index.html。';
    elements.destinationUpdated.textContent = '';
    elements.themeLabel.textContent = 'Local setup';
    elements.themeTitle.textContent = '雙擊 start.bat';
    elements.themeIntro.textContent = '啟動檔會建立本機伺服器，並自動開啟正確網址。';
    elements.dataStatus.className = 'data-status error';
    elements.dataStatus.textContent = '請在 Travel 資料夾雙擊 start.bat，然後使用 http://127.0.0.1:8000/。停止時關閉「Travel Atlas Server」命令視窗。';
    elements.contentPanel.setAttribute('aria-busy', 'false');
  };

  const start = async () => {
    if (location.protocol === 'file:') {
      showFileProtocolHelp();
      return;
    }
    elements.locationButton.addEventListener('click', requestUserLocation);
    elements.mapFocusButton.addEventListener('click', () => fitMap(false));


    try {
      const registry = await fetchJson('destinations.json');
      if (!Array.isArray(registry.destinations)) throw new Error('destinations.json 格式不正確');
      destinations = registry.destinations.filter(destination => destination.status === 'published');
      renderDestinationOptions();

      const params = new URLSearchParams(location.search);
      await loadDestination(params.get('destination'), params.get('theme'));

      elements.destinationSelect.addEventListener('change', () => loadDestination(elements.destinationSelect.value, null, {push: true}).catch(showFatalError));
      window.addEventListener('popstate', () => {
        const current = new URLSearchParams(location.search);
        const destinationId = current.get('destination');
        const themeId = current.get('theme');
        if (activeManifest?.id === destinationId) loadTheme(themeId);
        else loadDestination(destinationId, themeId).catch(showFatalError);
      });
    } catch (error) {
      showFatalError(error);
    }
  };

  start();
})();
