document.addEventListener('DOMContentLoaded', () => {
    const state = {
        map: null, currentTileLayer: null, currentLabelsLayer: null, temporaryMarker: null,
        allIssues: [], myReportedIssues: [], issueMarkers: L.layerGroup(),
        activeTab: 'allIssues', currentFilters: { category: 'all', status: 'all' },
        editingIssueId: null, debounceTimer: null,
        currentUser: null, appInitialized: false
    };
    const config = {
        defaultTheme: 'satellite',
        mapDefaultCenter: [28.6139, 77.2090], mapDefaultZoom: 12,
        storageKeys: { issues: 'civictrack_issues_data', theme: 'civictrack_theme', session: 'civictrack_session' },
        flagThreshold: 3,
    };
    const elements = {
        pageLoader: document.getElementById('page-loader'), modalOverlay: document.getElementById('modalOverlay'),
        allModals: document.querySelectorAll('.modal-content'), loginModal: document.getElementById('loginModal'),
        categoryFilterContainer: document.getElementById('categoryFilter'), statusFilterContainer: document.getElementById('statusFilter'),
        issuesEmptyState: document.getElementById('issuesEmptyState'), mainFilters: document.getElementById('mainFilters'),
        submitIssueBtn: document.getElementById('submitIssueBtn'), issueTitle: document.getElementById('issueTitle'),
        issueDesc: document.getElementById('issueDesc'), issueCategory: document.getElementById('issueCategory'),
        issueRadius: document.getElementById('issueRadius'), issueImage: document.getElementById('issueImage'),
        imageFileLabel: document.querySelector('.file-label span'), searchInput: document.getElementById('searchInput'),
        modalTitle: document.getElementById('modalTitle'), logoutBtn: document.getElementById('logoutBtn'),
        welcomeMessage: document.getElementById('welcomeMessage'), adminTab: document.getElementById('adminTab'),
        adminPanel: document.getElementById('adminPanel'), flaggedIssuesContainer: document.getElementById('flaggedIssuesContainer'),
        flaggedEmptyState: document.getElementById('flaggedEmptyState'), controlPanel: document.querySelector('.control-panel'),
        loginBtn: document.getElementById('loginBtn'), viewTabs: document.getElementById('viewTabs'),
    };
    const ICONS = {
        Reported: L.icon({ iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-yellow.png', shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png', iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41] }),
        'In Progress': L.icon({ iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-blue.png', shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png', iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41] }),
        Resolved: L.icon({ iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png', shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png', iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41] }),
        Flagged: L.icon({ iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-orange.png', shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png', iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41] }),
        New: L.icon({ iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png', shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png', iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41] }),
    };

    const formatDate = (isoString) => new Date(isoString).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    const saveIssues = () => {
        localStorage.setItem(config.storageKeys.issues, JSON.stringify(state.allIssues));
    };

    // --- UI & MODALS ---
    const openModal = (modalId) => { elements.modalOverlay.classList.add('visible'); document.getElementById(modalId).classList.add('active'); };
    const closeModal = () => {
        elements.modalOverlay.classList.remove('visible');
        elements.allModals.forEach(m => m.classList.remove('active'));
        if (state.temporaryMarker) { state.map.removeLayer(state.temporaryMarker); state.temporaryMarker = null; }
        state.editingIssueId = null;
        elements.modalTitle.innerHTML = '<i class="fas fa-bullhorn"></i> Report a New Issue';
        document.getElementById('reportIssueModal').querySelector('.modal-footer .cta-btn').textContent = 'Submit Report';
        elements.submitIssueBtn.disabled = true;
        elements.issueTitle.value = ''; elements.issueDesc.value = ''; elements.issueImage.value = '';
        elements.imageFileLabel.textContent = 'Choose Image';
    };

    // --- AUTHENTICATION ---
    function handleLogin() {
        const username = document.getElementById('usernameInput').value.trim();
        const password = document.getElementById('passwordInput').value.trim();
        const loginError = document.getElementById('loginError');

        if ((username === 'user' && password === 'password') || (username === 'user' && password === 'user')) {
            state.currentUser = { username, role: username === 'admin' ? 'admin' : 'user' };
            localStorage.setItem(config.storageKeys.session, JSON.stringify(state.currentUser));
            loginError.style.display = 'none';
            closeModal();
            initializeApp();
        } else {
            loginError.textContent = 'Invalid username or password.';
            loginError.style.display = 'block';
        }
    }
    function handleLogout() {
        state.currentUser = null;
        localStorage.removeItem(config.storageKeys.session);
        window.location.reload();
    }
    function checkAuth() {
        const session = localStorage.getItem(config.storageKeys.session);
        if (session) {
            state.currentUser = JSON.parse(session);
            if (!state.appInitialized) initializeApp();
        } else {
            elements.pageLoader.classList.add('hidden');
            openModal('loginModal');
        }
    }

    // --- THEME & SETTINGS ---
    function applyTheme(themeName) {
        document.documentElement.className = `theme-${themeName}`;
        if (!state.map) return;

        setTimeout(() => {
            const tilesUrl = getComputedStyle(document.documentElement).getPropertyValue('--map-tiles').trim().slice(1, -1);
            const labelsUrl = getComputedStyle(document.documentElement).getPropertyValue('--map-labels-layer').trim().slice(1, -1);
            const attribution = getComputedStyle(document.documentElement).getPropertyValue('--map-attribution').trim().slice(1, -1);

            if (state.currentTileLayer) state.map.removeLayer(state.currentTileLayer);
            if (state.currentLabelsLayer) { state.map.removeLayer(state.currentLabelsLayer); state.currentLabelsLayer = null; }

            state.currentTileLayer = L.tileLayer(tilesUrl, { attribution, maxZoom: 19 }).addTo(state.map);
            if (labelsUrl) {
                state.currentLabelsLayer = L.tileLayer(labelsUrl, { pane: 'labels' }).addTo(state.map);
            }
        }, 100);
    }

    //--- DATA & MAP LOGIC ---
    function populateFilters() {
        const categories = ["Roads", "Lighting", "Water Supply", "Cleanliness", "Public Safety", "Obstructions"];
        elements.categoryFilterContainer.innerHTML = '<button class="filter-btn active" data-category="all">All</button>';
        categories.forEach(category => {
            elements.categoryFilterContainer.innerHTML += `<button class="filter-btn" data-category="${category}">${category}</button>`;
        });
        const statuses = ['Reported', 'In Progress', 'Resolved'];
        elements.statusFilterContainer.innerHTML = '<button class="filter-btn active" data-status="all">All</button>';
        statuses.forEach(status => {
            elements.statusFilterContainer.innerHTML += `<button class="filter-btn" data-status="${status}">${status}</button>`;
        });
    }

    function renderIssuesOnMap() {
        state.issueMarkers.clearLayers();
        let sourceArray = state.activeTab === 'myReports' ? state.myReportedIssues : state.allIssues;

        let issuesToDisplay = sourceArray.filter(issue => {
            const isFlaggedAndHidden = (issue.flagCount || 0) >= config.flagThreshold && state.currentUser.role !== 'admin';
            if (isFlaggedAndHidden) return false;
            if (state.activeTab !== 'admin') {
                const matchesCategory = state.currentFilters.category === 'all' || issue.category === state.currentFilters.category;
                const matchesStatus = state.currentFilters.status === 'all' || issue.status === state.currentFilters.status;
                return matchesCategory && matchesStatus;
            }
            return true;
        });

        elements.issuesEmptyState.style.display = (issuesToDisplay.length === 0 && state.activeTab !== 'admin') ? 'block' : 'none';

        issuesToDisplay.forEach(issue => {
            const isFlagged = (issue.flagCount || 0) >= config.flagThreshold;
            const markerIcon = isFlagged ? ICONS.Flagged : (ICONS[issue.status] || ICONS.Reported);
            const marker = L.marker([issue.lat, issue.lng], { icon: markerIcon });

            const isOwner = issue.reporter === state.currentUser.username;
            const canAdmin = state.currentUser.role === 'admin';
            let actionsHTML = '';
            if (isOwner || canAdmin) {
                actionsHTML += `<button class="popup-action-btn" onclick="window.civictrack.openEditModal('${issue.id}')" title="Edit"><i class="fas fa-edit"></i></button>`;
                actionsHTML += `<button class="popup-action-btn delete" onclick="window.civictrack.deleteReport('${issue.id}')" title="Delete"><i class="fas fa-trash-alt"></i></button>`;
            }
            if (!isOwner && !canAdmin) {
                actionsHTML += `<button class="popup-action-btn flag" onclick="window.civictrack.flagReport('${issue.id}')" title="Flag as Inappropriate"><i class="fas fa-flag"></i></button>`;
            }

            let statusHistoryHTML = '<h5>Status History</h5>';
            issue.statusHistory.forEach(h => { statusHistoryHTML += `<div class="history-entry"><strong>${h.status}</strong> on ${formatDate(h.timestamp)}</div>`; });

            marker.bindPopup(`<div class="popup-card">
                <img src="${issue.photo || 'https://placehold.co/300x140/e9ecef/6c757d?text=No+Image'}" alt="${issue.title}" class="popup-card-image">
                <div class="popup-card-content">
                    <div class="popup-card-header"><h4>${issue.title}</h4><div class="popup-card-actions">${actionsHTML}</div></div>
                    <p>${issue.description}</p>
                    <div class="status-history">${statusHistoryHTML}</div>
                    <div class="popup-card-footer">
                        <span class="status-badge" style="background-color: var(--status-${issue.status.toLowerCase().replace(' ', '')})">${issue.status}</span>
                        <span>Impact Radius: <strong>${issue.radius} km</strong></span>
                    </div>
                </div>
            </div>`);
            state.issueMarkers.addLayer(marker);
        });
    }

    function renderAdminPanel() {
        const flaggedIssues = state.allIssues.filter(i => (i.flagCount || 0) >= config.flagThreshold);
        elements.flaggedIssuesContainer.innerHTML = '';
        elements.flaggedEmptyState.style.display = flaggedIssues.length > 0 ? 'none' : 'block';
        flaggedIssues.forEach(issue => {
            elements.flaggedIssuesContainer.innerHTML += `
                <div class="flagged-issue-card">
                    <p>${issue.title}</p>
                    <span>Flags: ${issue.flagCount} by <a href="#" onclick="event.preventDefault(); window.civictrack.flyToIssue('${issue.id}')">View on Map</a></span>
                    <div class="admin-actions">
                        <button class="resolve-btn" onclick="window.civictrack.resolveIssue('${issue.id}')">Mark Resolved</button>
                        <button class="dismiss-btn" onclick="window.civictrack.dismissFlags('${issue.id}')">Dismiss Flags</button>
                    </div>
                </div>`;
        });
    }

    async function loadInitialData() {
        try {
            const storedData = localStorage.getItem(config.storageKeys.issues);
            if (storedData) {
                state.allIssues = JSON.parse(storedData);
            } else {
                const response = await fetch('issues.json');
                if (!response.ok) throw new Error('Network response failed');
                state.allIssues = await response.json();
                state.allIssues.forEach(issue => {
                    issue.statusHistory = [{ status: issue.status, timestamp: issue.timestamp }];
                    issue.flagCount = 0;
                    issue.reporter = 'community';
                });
            }
            state.myReportedIssues = state.allIssues.filter(i => i.reporter === state.currentUser.username);
            saveIssues();
        } catch (error) { console.error("Failed to load issues:", error); }
        finally { renderApp(); }
    }

    function startReportingProcess() {
        closeModal();
        state.map.getContainer().style.cursor = 'crosshair';
        const onMapClick = (e) => {
            state.map.getContainer().style.cursor = '';
            if (state.temporaryMarker) state.map.removeLayer(state.temporaryMarker);
            state.temporaryMarker = L.marker(e.latlng, { icon: ICONS.New }).addTo(state.map);
            elements.submitIssueBtn.disabled = false;
            openModal('reportIssueModal');
            state.map.off('click', onMapClick);
        };
        state.map.on('click', onMapClick);
    }

    function handleFormSubmit() {
        if (!elements.issueTitle.value || !elements.issueDesc.value) return;
        const file = elements.issueImage.files[0];
        const processData = (photoData) => {
            if (state.editingIssueId) {
                const issue = state.allIssues.find(i => i.id === state.editingIssueId);
                Object.assign(issue, { title: elements.issueTitle.value, description: elements.issueDesc.value, category: elements.issueCategory.value, radius: elements.issueRadius.value });
                if (photoData) issue.photo = photoData;
            } else {
                const timestamp = new Date().toISOString();
                const newIssueData = {
                    id: 'user_' + Date.now(), title: elements.issueTitle.value, description: elements.issueDesc.value,
                    category: elements.issueCategory.value, radius: elements.issueRadius.value, status: "Reported",
                    lat: state.temporaryMarker.getLatLng().lat, lng: state.temporaryMarker.getLatLng().lng,
                    timestamp, reporter: state.currentUser.username, photo: photoData,
                    statusHistory: [{ status: 'Reported', timestamp }], flagCount: 0,
                };
                state.allIssues.unshift(newIssueData);
                state.myReportedIssues.unshift(newIssueData);
            }
            saveIssues();
            renderApp();
            closeModal();
            if (!state.editingIssueId) openModal('successModal');
        };
        if (file) { const reader = new FileReader(); reader.onload = (e) => processData(e.target.result); reader.readAsDataURL(file); }
        else { processData(state.editingIssueId ? (state.allIssues.find(i => i.id === state.editingIssueId)?.photo || null) : null); }
    }

    window.civictrack = {
        openEditModal: (issueId) => {
            const issue = state.allIssues.find(i => i.id === issueId);
            if (!issue) return;
            state.editingIssueId = issueId;
            elements.modalTitle.innerHTML = '<i class="fas fa-edit"></i> Edit Issue Report';
            document.getElementById('reportIssueModal').querySelector('.modal-footer .cta-btn').textContent = 'Save Changes';
            elements.issueTitle.value = issue.title; elements.issueDesc.value = issue.description;
            elements.issueCategory.value = issue.category; elements.issueRadius.value = issue.radius;
            elements.submitIssueBtn.disabled = false;
            openModal('reportIssueModal');
        },
        deleteReport: (issueId) => {
            if (confirm("Are you sure you want to permanently delete this report?")) {
                state.allIssues = state.allIssues.filter(i => i.id !== issueId);
                state.myReportedIssues = state.myReportedIssues.filter(i => i.id !== issueId);
                saveIssues(); renderApp();
            }
        },
        flagReport: (issueId) => {
            const issue = state.allIssues.find(i => i.id === issueId);
            if (issue) {
                issue.flagCount = (issue.flagCount || 0) + 1;
                alert(`Report flagged! It will be hidden for review if it receives ${config.flagThreshold} flags.`);
                saveIssues(); renderApp();
            }
        },
        resolveIssue: (issueId) => {
            const issue = state.allIssues.find(i => i.id === issueId);
            if (issue) {
                issue.status = 'Resolved'; issue.statusHistory.push({ status: 'Resolved', timestamp: new Date().toISOString() });
                issue.flagCount = 0; saveIssues(); renderApp();
            }
        },
        dismissFlags: (issueId) => {
            const issue = state.allIssues.find(i => i.id === issueId);
            if (issue) { issue.flagCount = 0; alert('Flags dismissed.'); saveIssues(); renderApp(); }
        },
        flyToIssue: (issueId) => {
            const issue = state.allIssues.find(i => i.id === issueId);
            if (issue) {
                state.map.flyTo([issue.lat, issue.lng], 16);
                state.issueMarkers.eachLayer(marker => {
                    if (marker.getLatLng().lat.toFixed(5) === issue.lat.toFixed(5) && marker.getLatLng().lng.toFixed(5) === issue.lng.toFixed(5)) {
                        marker.openPopup();
                    }
                });
            }
        }
    };

    function geocodeAndFly(query) {
        if (!query) return;
        fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}`)
            .then(res => res.json()).then(data => { if (data && data.length > 0) { state.map.flyTo([data[0].lat, data[0].lon], 14); } })
            .catch(err => console.error("Geocoding error:", err));
    }

    function renderApp() {
        renderIssuesOnMap();
        if (state.currentUser.role === 'admin') renderAdminPanel();
    }

    function setupUIForRole() {
        elements.welcomeMessage.textContent = `Hi, ${state.currentUser.username}`;
        elements.adminTab.style.display = state.currentUser.role === 'admin' ? 'block' : 'none';
    }

    function handleTabClick(e) {
        const tabButton = e.target.closest('.tab-btn');
        if (!tabButton) return;

        state.activeTab = tabButton.dataset.tab;

        elements.viewTabs.querySelectorAll('.tab-btn').forEach(t => t.classList.remove('active'));
        tabButton.classList.add('active');

        document.querySelectorAll('.view-panel, #mainFilters').forEach(p => p.classList.remove('active-view'));

        if (state.activeTab === 'admin') {
            elements.adminPanel.classList.add('active-view');
        } else {
            elements.mainFilters.classList.add('active-view');
        }
        renderApp();
    }

    function bindEventListeners() {
        document.querySelectorAll('.close-modal-btn').forEach(btn => btn.addEventListener('click', closeModal));
        elements.modalOverlay.addEventListener('click', (e) => e.target === elements.modalOverlay && closeModal());
        elements.logoutBtn.addEventListener('click', handleLogout);
        document.getElementById('reportIssueBtn').addEventListener('click', startReportingProcess);
        document.getElementById('mobileReportIssueBtn').addEventListener('click', startReportingProcess);
        document.getElementById('mobileSearchBtn').addEventListener('click', () => { const q = prompt("Enter a location:"); if (q) geocodeAndFly(q); });
        document.getElementById('appSettingsBtn').addEventListener('click', () => openModal('appSettingsModal'));
        document.getElementById('mobileMenuBtn').addEventListener('click', () => elements.controlPanel.classList.toggle('open'));
        elements.submitIssueBtn.addEventListener('click', handleFormSubmit);
        document.getElementById('successOkBtn').addEventListener('click', closeModal);
        document.getElementById('themeSelector').addEventListener('change', (e) => { applyTheme(e.target.value); localStorage.setItem(config.storageKeys.theme, e.target.value); });
        elements.issueImage.addEventListener('change', (e) => { elements.imageFileLabel.textContent = e.target.files[0] ? e.target.files[0].name : 'Choose Image'; });
        elements.searchInput.addEventListener('keyup', (e) => { clearTimeout(state.debounceTimer); state.debounceTimer = setTimeout(() => { geocodeAndFly(e.target.value); }, 750); });

        elements.viewTabs.addEventListener('click', handleTabClick);

        elements.categoryFilterContainer.addEventListener('click', (e) => {
            if (e.target.tagName === 'BUTTON') {
                elements.categoryFilterContainer.querySelectorAll('.filter-btn').forEach(btn => btn.classList.remove('active'));
                e.target.classList.add('active');
                state.currentFilters.category = e.target.dataset.category;
                renderApp();
            }
        });
        elements.statusFilterContainer.addEventListener('click', (e) => {
            if (e.target.tagName === 'BUTTON') {
                elements.statusFilterContainer.querySelectorAll('.filter-btn').forEach(btn => btn.classList.remove('active'));
                e.target.classList.add('active');
                state.currentFilters.status = e.target.dataset.status;
                renderApp();
            }
        });

        document.getElementById('zoomInBtn').addEventListener('click', () => state.map.zoomIn());
        document.getElementById('zoomOutBtn').addEventListener('click', () => state.map.zoomOut());
    }

    function initializeApp() {
        if (state.appInitialized) return;
        elements.pageLoader.classList.remove('hidden');
        setupUIForRole();

        state.map = L.map('map', { zoomControl: false }).setView(config.mapDefaultCenter, config.mapDefaultZoom);
        state.map.createPane('labels'); state.map.getPane('labels').style.zIndex = 650; state.map.getPane('labels').style.pointerEvents = 'none';
        state.issueMarkers.addTo(state.map);

        const savedTheme = localStorage.getItem(config.storageKeys.theme) || config.defaultTheme;
        document.querySelector(`.theme-label input[value="${savedTheme}"]`).checked = true;
        applyTheme(savedTheme);

        populateFilters();
        bindEventListeners();
        loadInitialData();

        state.appInitialized = true;
        setTimeout(() => elements.pageLoader.classList.add('hidden'), 500);
    }

    elements.loginBtn.addEventListener('click', handleLogin);
    checkAuth();
});