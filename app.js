// ============ CONFIGURAZIONE ============
const supabaseClient = window.supabase.createClient(
    window.SUPABASE_URL,
    window.SUPABASE_ANON_KEY
);

let currentUser = null;
let currentProfile = null;
let currentMarketId = null;
let realtimeChannel = null;
let isSignUp = true;
let profileReturnView = 'main-view';
let marketReturnView = 'main-view';

// ============ UTILITY ============
function show(id) { document.getElementById(id).classList.remove('hidden'); }
function hide(id) { document.getElementById(id).classList.add('hidden'); }

function getCurrentView() {
    const views = ['main-view', 'market-view', 'profile-view', 'admin-view', 'public-profile-view'];
    for (const v of views) {
        const el = document.getElementById(v);
        if (el && !el.classList.contains('hidden')) return v;
    }
    return 'main-view';
}

function formatDate(dateStr) {
    const d = new Date(dateStr);
    return d.toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: 'numeric' });
}

function timeAgo(dateStr) {
    const seconds = Math.floor((new Date() - new Date(dateStr)) / 1000);
    if (seconds < 60) return 'ora';
    if (seconds < 3600) return Math.floor(seconds / 60) + 'm';
    if (seconds < 86400) return Math.floor(seconds / 3600) + 'h';
    return Math.floor(seconds / 86400) + 'g';
}

// ============ LMSR ============
function costFunction(qYes, qNo, b) {
    const maxQ = Math.max(qYes, qNo);
    const expYes = Math.exp((qYes - maxQ) / b);
    const expNo = Math.exp((qNo - maxQ) / b);
    return maxQ + b * Math.log(expYes + expNo);
}

function priceYes(qYes, qNo, b) {
    const expYes = Math.exp(qYes / b);
    const expNo = Math.exp(qNo / b);
    return expYes / (expYes + expNo);
}

// ============ AUTENTICAZIONE ============
async function initAuth() {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (session) {
        currentUser = session.user;
        await loadProfile();
        showApp();
    } else {
        hide('loading');
        show('auth-screen');
    }

    supabaseClient.auth.onAuthStateChange(async (event, session) => {
        if (event === 'SIGNED_IN' && session) {
            currentUser = session.user;
            await loadProfile();
            showApp();
        } else if (event === 'SIGNED_OUT') {
            currentUser = null;
            currentProfile = null;
            show('auth-screen');
            hide('app');
        }
    });
}

document.getElementById('auth-toggle').addEventListener('click', (e) => {
    if (e.target.id === 'toggle-mode') {
        e.preventDefault();
        isSignUp = !isSignUp;
        document.getElementById('auth-submit').textContent = isSignUp ? 'Registrati' : 'Accedi';
        document.getElementById('toggle-mode').textContent = isSignUp ? 'Accedi' : 'Registrati';
        document.querySelector('.auth-toggle').firstChild.textContent = isSignUp ? 'Hai già un account? ' : 'Non hai un account? ';
    }
});

document.getElementById('auth-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('username').value.trim();
    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;
    const errorEl = document.getElementById('auth-error');
    errorEl.textContent = '';

    try {
        if (isSignUp) {
            if (!username) throw new Error('Inserisci un username');
            const { data, error } = await supabaseClient.auth.signUp({
                email,
                password,
                options: { data: { username } }
            });
            if (error) throw error;
            if (!data.session) {
                errorEl.textContent = 'Controlla la tua email per confermare la registrazione.';
            }
        } else {
            const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
            if (error) throw error;
        }
    } catch (err) {
        errorEl.textContent = err.message;
    }
});

async function loadProfile() {
    const { data, error } = await supabaseClient
        .from('profiles')
        .select('*')
        .eq('id', currentUser.id)
        .single();
    if (error) console.error(error);
    currentProfile = data;
    if (currentProfile) {
        document.getElementById('credits-badge').textContent = currentProfile.credits;
    }
}

// ============ APP ============
function showApp() {
    hide('loading');
    hide('auth-screen');
    show('app');
    loadMarkets();
}

// ============ MERCATI ============
async function loadMarkets(category = 'all') {
    let query = supabaseClient
        .from('markets')
        .select('*')
        .order('created_at', { ascending: false });

    if (category !== 'all') {
        query = query.eq('category', category);
    }

    const { data, error } = await query;
    if (error) { console.error(error); return; }

    const list = document.getElementById('markets-list');
    if (!data || data.length === 0) {
        list.innerHTML = '<div class="empty-state"><p>Nessun mercato ancora. Creane uno!</p></div>';
        return;
    }

    list.innerHTML = data.map(m => {
        const pYes = priceYes(Number(m.q_yes), Number(m.q_no), Number(m.b));
        const pNo = 1 - pYes;
        const statusLabel = m.status === 'open' ? 'Aperto' : m.status === 'closed' ? 'Chiuso' : 'Risolto';
        return `
            <div class="market-card" data-id="${m.id}">
                <h3>${m.question}</h3>
                <div class="market-prices">
                    <div class="price-box yes">
                        <span class="price">${Math.round(pYes * 100)}%</span>
                        <span class="label">YES</span>
                    </div>
                    <div class="price-box no">
                        <span class="price">${Math.round(pNo * 100)}%</span>
                        <span class="label">NO</span>
                    </div>
                </div>
                <div class="market-meta">
                    <span class="market-status ${m.status}">${statusLabel}</span>
                    <span>Vol. ${m.total_volume} · ${formatDate(m.created_at)}</span>
                </div>
            </div>
        `;
    }).join('');

    list.querySelectorAll('.market-card').forEach(card => {
        card.addEventListener('click', () => openMarket(card.dataset.id));
    });
}

document.querySelectorAll('.filter-chip').forEach(chip => {
    chip.addEventListener('click', () => {
        document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        loadMarkets(chip.dataset.category);
    });
});

// ============ DETTAGLIO MERCATO ============
async function openMarket(id) {
    currentMarketId = id;
    marketReturnView = getCurrentView();
    hide('main-view');
    hide('profile-view');
    hide('admin-view');
    hide('public-profile-view');
    show('market-view');

    const { data: market, error } = await supabaseClient
        .from('markets')
        .select('*')
        .eq('id', id)
        .single();

    if (error) { console.error(error); return; }

    const pYes = priceYes(Number(market.q_yes), Number(market.q_no), Number(market.b));
    const pNo = 1 - pYes;

    document.getElementById('market-detail').innerHTML = `
        <div class="market-detail-header">
            <h2>${market.question}</h2>
            ${market.description ? `<p class="market-detail-desc">${market.description}</p>` : ''}
        </div>
        <div class="bet-panel">
            <div class="bet-panel-tabs">
                <button class="bet-panel-tab-dot active" data-page="0"></button>
                <button class="bet-panel-tab-dot" data-page="1"></button>
            </div>
            <div class="bet-panel-slider" id="bet-panel-slider">
                <div class="bet-panel-page">
                    <div class="prices">
                        <div class="price-box yes">
                            <span class="price">${Math.round(pYes * 100)}%</span>
                            <span class="label">YES</span>
                        </div>
                        <div class="price-box no">
                            <span class="price">${Math.round(pNo * 100)}%</span>
                            <span class="label">NO</span>
                        </div>
                    </div>
                    ${market.status === 'open' ? `
                        <button class="btn-yes" onclick="openBetModal(true)">Scommetti YES</button>
                        <button class="btn-no" onclick="openBetModal(false)">Scommetti NO</button>
                    ` : `<p style="text-align:center;color:var(--text-muted)">Mercato ${market.status}</p>`}
                </div>
                <div class="bet-panel-page">
                    <div id="participants-list" class="participants-list">
                        <div class="participants-empty">Caricamento...</div>
                    </div>
                </div>
            </div>
        </div>
    `;

    initBetPanelSwipe();
    loadParticipants(id);
    loadComments(id);
    subscribeToMarket(id);
}

// ============ SWIPE BET PANEL ============
function initBetPanelSwipe() {
    const slider = document.getElementById('bet-panel-slider');
    const dots = document.querySelectorAll('.bet-panel-tab-dot');
    if (!slider) return;

    let currentPage = 0;
    let startX = 0;
    let startY = 0;
    let isDragging = false;
    let isHorizontal = null;

    function goToPage(index) {
        currentPage = Math.max(0, Math.min(1, index));
        slider.style.transition = 'transform 0.3s ease-out';
        slider.style.transform = `translateX(-${currentPage * 50}%)`;
        dots.forEach((d, i) => d.classList.toggle('active', i === currentPage));
    }

    dots.forEach(dot => {
        dot.addEventListener('click', () => goToPage(parseInt(dot.dataset.page)));
    });

    slider.addEventListener('touchstart', (e) => {
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
        isDragging = true;
        isHorizontal = null;
        slider.style.transition = 'none';
    }, { passive: true });

    slider.addEventListener('touchmove', (e) => {
        if (!isDragging) return;
        const dx = e.touches[0].clientX - startX;
        const dy = e.touches[0].clientY - startY;

        if (isHorizontal === null && (Math.abs(dx) > 5 || Math.abs(dy) > 5)) {
            isHorizontal = Math.abs(dx) > Math.abs(dy);
        }

        if (!isHorizontal) return;

        e.preventDefault();

        const offsetPercent = (dx / slider.offsetWidth) * 100;
        const base = -currentPage * 50;
        slider.style.transform = `translateX(${base + offsetPercent}%)`;
    }, { passive: false });

    slider.addEventListener('touchend', (e) => {
        if (!isDragging) return;
        isDragging = false;

        if (!isHorizontal) return;

        const dx = e.changedTouches[0].clientX - startX;
        const threshold = slider.offsetWidth * 0.15;

        if (dx < -threshold && currentPage < 1) {
            goToPage(1);
        } else if (dx > threshold && currentPage > 0) {
            goToPage(0);
        } else {
            goToPage(currentPage);
        }
    }, { passive: true });
}

// ============ LISTA PARTECIPANTI ============
async function loadParticipants(marketId) {
    const listEl = document.getElementById('participants-list');
    if (!listEl) return;

    const { data, error } = await supabaseClient
        .from('positions')
        .select('shares, side, user_id, profiles(username)')
        .eq('market_id', marketId)
        .gt('shares', 0);

    if (error) {
        console.error(error);
        listEl.innerHTML = '<div class="participants-empty">Errore nel caricamento</div>';
        return;
    }

    if (!data || data.length === 0) {
        listEl.innerHTML = '<div class="participants-empty">Nessuno ha ancora scommesso. Sii il primo!</div>';
        return;
    }

    data.sort((a, b) => Number(b.shares) - Number(a.shares));

    const totalShares = data.reduce((sum, p) => sum + Number(p.shares), 0);

    const rows = data.map(p => {
        const username = p.profiles?.username || 'Utente';
        return `
            <div class="participant-row">
                <div class="participant-info" data-user-id="${p.user_id}">
                    <span class="participant-username">${username}</span>
                    <span class="participant-side ${p.side ? 'yes' : 'no'}">${p.side ? 'YES' : 'NO'}</span>
                </div>
                <span class="participant-amount">${Math.floor(Number(p.shares))}</span>
            </div>
        `;
    }).join('');

    listEl.innerHTML = rows +
        `<div class="participants-total">${data.length} partecipant${data.length === 1 ? 'e' : 'i'} · ${Math.floor(totalShares)} crediti totali</div>`;
}

document.getElementById('back-to-home').addEventListener('click', () => {
    hide('market-view');
    show(marketReturnView);
    if (realtimeChannel) { supabaseClient.removeChannel(realtimeChannel); realtimeChannel = null; }
    if (marketReturnView === 'main-view') loadMarkets();
});

// ============ REALTIME ============
function subscribeToMarket(marketId) {
    if (realtimeChannel) supabaseClient.removeChannel(realtimeChannel);

    realtimeChannel = supabaseClient
        .channel(`market:${marketId}`)
        .on('broadcast', { event: 'UPDATE' }, (payload) => {
            if (payload.new && payload.new.q_yes !== undefined) {
                const pYes = priceYes(Number(payload.new.q_yes), Number(payload.new.q_no), Number(payload.new.b));
                document.querySelectorAll('.bet-panel .price-box.yes .price').forEach(el => el.textContent = Math.round(pYes * 100) + '%');
                document.querySelectorAll('.bet-panel .price-box.no .price').forEach(el => el.textContent = Math.round((1 - pYes) * 100) + '%');
            }
        })
        .on('broadcast', { event: 'INSERT' }, (payload) => {
            if (payload.new && payload.new.market_id === marketId) {
                appendComment(payload.new);
            }
        })
        .subscribe();
}

// ============ COMMENTI ============
async function loadComments(marketId) {
    const { data, error } = await supabaseClient
        .from('comments')
        .select('*, profiles(username)')
        .eq('market_id', marketId)
        .order('created_at', { ascending: true })
        .limit(50);

    if (error) { console.error(error); return; }

    const list = document.getElementById('comments-list');
    if (!data || data.length === 0) {
        list.innerHTML = '<p style="color:var(--text-muted);font-size:14px">Nessun commento. Sii il primo!</p>';
        return;
    }
    list.innerHTML = data.map(c => renderComment(c)).join('');
}

function renderComment(c) {
    const username = c.profiles?.username || 'Utente';
    return `
        <div class="comment-item" data-id="${c.id}">
            <div class="comment-author comment-author-link" data-user-id="${c.user_id}">${username}</div>
            <div class="comment-text">${c.content}</div>
            <div class="comment-time">${timeAgo(c.created_at)}</div>
        </div>
    `;
}

function appendComment(c) {
    const list = document.getElementById('comments-list');
    const empty = list.querySelector('p');
    if (empty) empty.remove();
    list.insertAdjacentHTML('beforeend', renderComment(c));
}

document.getElementById('send-comment').addEventListener('click', async () => {
    const input = document.getElementById('comment-input');
    const content = input.value.trim();
    if (!content || !currentMarketId) return;

    const { error } = await supabaseClient.from('comments').insert({
        market_id: currentMarketId,
        user_id: currentUser.id,
        content
    });

    if (error) { console.error(error); return; }
    input.value = '';
});

// ============ SCOMMESSA ============
let selectedSide = true;

window.openBetModal = function(side) {
    selectedSide = side;
    document.getElementById('bet-modal-title').textContent = side ? 'Scommetti YES' : 'Scommetti NO';
    document.querySelectorAll('.bet-side').forEach(b => b.classList.remove('selected'));
    document.querySelector(`.bet-side.${side ? 'yes' : 'no'}`).classList.add('selected');
    document.getElementById('bet-amount').value = 10;
    updateBetPreview();
    show('bet-modal');
};

document.querySelectorAll('.bet-side').forEach(btn => {
    btn.addEventListener('click', () => {
        selectedSide = btn.dataset.side === 'true';
        document.querySelectorAll('.bet-side').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        updateBetPreview();
    });
});

document.getElementById('bet-amount').addEventListener('input', updateBetPreview);

async function updateBetPreview() {
    const amount = parseInt(document.getElementById('bet-amount').value) || 0;
    const { data: market } = await supabaseClient.from('markets').select('*').eq('id', currentMarketId).single();
    if (!market) return;

    const qYes = Number(market.q_yes);
    const qNo = Number(market.q_no);
    const b = Number(market.b);
    const cost = costFunction(selectedSide ? qYes + amount : qYes, selectedSide ? qNo : qNo + amount, b) - costFunction(qYes, qNo, b);
    const costInt = Math.ceil(cost);
    const pYes = priceYes(qYes, qNo, b);
    const currentPrice = selectedSide ? pYes : 1 - pYes;
    const potentialPayout = currentPrice > 0 ? Math.floor(amount / currentPrice) : 0;

    document.getElementById('bet-preview').innerHTML =
        `Costo: <strong>${costInt}</strong> crediti<br>Payout potenziale: <strong>${potentialPayout}</strong> crediti`;
}

document.getElementById('confirm-bet').addEventListener('click', async () => {
    const amount = parseInt(document.getElementById('bet-amount').value) || 0;
    if (amount < 1) return alert('Inserisci una quantità valida');
    if (currentProfile.credits < amount) return alert('Crediti insufficienti');

    const { data: market } = await supabaseClient.from('markets').select('*').eq('id', currentMarketId).single();
    const qYes = Number(market.q_yes);
    const qNo = Number(market.q_no);
    const b = Number(market.b);

    const newQYes = selectedSide ? qYes + amount : qYes;
    const newQNo = selectedSide ? qNo : qNo + amount;
    const cost = Math.ceil(costFunction(newQYes, newQNo, b) - costFunction(qYes, qNo, b));

    if (cost > currentProfile.credits) return alert('Crediti insufficienti per questa scommessa');

    const { error } = await supabaseClient.rpc('execute_bet', {
        p_user_id: currentUser.id,
        p_market_id: currentMarketId,
        p_side: selectedSide,
        p_shares: amount,
        p_cost: cost,
        p_new_q_yes: newQYes,
        p_new_q_no: newQNo
    });

    if (error) { alert(error.message); return; }

    hide('bet-modal');
    await loadProfile();
    await openMarket(currentMarketId);
    await supabaseClient.channel(`market:${currentMarketId}`).send({
        type: 'broadcast', event: 'UPDATE',
        payload: { new: { q_yes: newQYes, q_no: newQNo, b } }
    });
});

document.getElementById('cancel-bet').addEventListener('click', () => hide('bet-modal'));

// ============ CREAZIONE MERCATO ============
document.getElementById('create-market-btn').addEventListener('click', () => show('create-modal'));
document.getElementById('cancel-create').addEventListener('click', () => hide('create-modal'));

document.getElementById('create-market-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const question = document.getElementById('market-question').value.trim();
    const description = document.getElementById('market-description').value.trim();
    const category = document.getElementById('market-category').value;
    const closesAt = document.getElementById('market-closes').value;

    const { error } = await supabaseClient.from('markets').insert({
        creator_id: currentUser.id,
        question,
        description: description || null,
        category,
        closes_at: closesAt ? new Date(closesAt).toISOString() : null,
        status: 'open',
        q_yes: 0,
        q_no: 0,
        b: 100
    });

    if (error) { alert(error.message); return; }

    hide('create-modal');
    document.getElementById('create-market-form').reset();
    loadMarkets();
});

// ============ PROFILO ============
document.getElementById('profile-btn').addEventListener('click', async () => {
    profileReturnView = getCurrentView();
    hide('main-view');
    hide('market-view');
    hide('admin-view');
    hide('public-profile-view');
    show('profile-view');
    await loadProfileView();
});

document.getElementById('back-from-profile').addEventListener('click', () => {
    hide('profile-view');
    show(profileReturnView);
});

function renderBetHistory(positions) {
    if (!positions || positions.length === 0) {
        return '<p class="bet-history-empty">Nessuna puntata ancora</p>';
    }

    // Ordina per data di creazione del mercato (più recenti in alto)
    const sorted = [...positions].sort((a, b) => {
        const da = a.markets?.created_at || '';
        const db = b.markets?.created_at || '';
        return db.localeCompare(da);
    });

    return sorted.map(p => {
        const m = p.markets;
        if (!m) return '';

        let statusHtml = '';
        if (m.status === 'resolved') {
            const won = (p.side === true && m.outcome === true) ||
                        (p.side === false && m.outcome === false);
            statusHtml = won
                ? '<span class="bet-history-status won">Vinta</span>'
                : '<span class="bet-history-status lost">Persa</span>';
        } else if (m.status === 'closed') {
            statusHtml = '<span class="bet-history-status pending">In attesa</span>';
        } else {
            statusHtml = '<span class="bet-history-status open">Aperto</span>';
        }

        return `
            <div class="bet-history-card" data-market-id="${m.id}">
                <div class="bet-history-question">${m.question}</div>
                <div class="bet-history-details">
                    <span class="bet-history-side ${p.side ? 'yes' : 'no'}">${p.side ? 'YES' : 'NO'}</span>
                    <span class="bet-history-shares">${Math.floor(Number(p.shares))} shares</span>
                    ${statusHtml}
                </div>
            </div>
        `;
    }).join('');
}

async function loadProfileView() {
    const { data: positions } = await supabaseClient
        .from('positions')
        .select('*, markets(id, question, status, outcome, created_at)')
        .eq('user_id', currentUser.id);

    const { data: txs } = await supabaseClient
        .from('transactions')
        .select('*')
        .eq('user_id', currentUser.id)
        .order('created_at', { ascending: false })
        .limit(20);

    const totalBets = positions?.length || 0;
    const wonPositions = positions?.filter(p =>
        p.markets?.status === 'resolved' &&
        ((p.side === true && p.markets.outcome === true) || (p.side === false && p.markets.outcome === false))
    ).length || 0;
    const winRate = totalBets > 0 ? Math.round((wonPositions / totalBets) * 100) : 0;

    let content = `
        <div class="profile-header">
            <div class="profile-avatar">${(currentProfile.username || 'U')[0].toUpperCase()}</div>
            <h2>${currentProfile.username}</h2>
            <p style="color:var(--text-muted);font-size:13px">Iscritto dal ${formatDate(currentProfile.created_at)}</p>
        </div>
        <div class="profile-stats">
            <div class="stat-card">
                <div class="stat-value">${currentProfile.credits}</div>
                <div class="stat-label">Crediti</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${winRate}%</div>
                <div class="stat-label">Win Rate</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${totalBets}</div>
                <div class="stat-label">Scommesse</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${wonPositions}</div>
                <div class="stat-label">Vinte</div>
            </div>
        </div>
    `;

    if (currentProfile.role === 'admin') {
        content += `<button class="btn-yes" style="margin-bottom:16px" onclick="openAdmin()">Pannello Admin</button>`;
    }

    content += `<h3 style="margin-bottom:12px;font-size:16px">Le tue puntate</h3>`;
    content += `<div class="bet-history-list">${renderBetHistory(positions)}</div>`;

    content += `<h3 style="margin:24px 0 12px 0;font-size:16px">Ultime transazioni</h3>`;
    }

    content += `<h3 style="margin-bottom:12px;font-size:16px">Ultime transazioni</h3>`;
    if (txs && txs.length > 0) {
        content += txs.map(t => `
            <div class="admin-user-row">
                <div>
                    <div class="username">${t.type === 'bet' ? 'Scommessa' : t.type === 'admin_grant' ? 'Ricarica' : t.type}</div>
                    <div class="user-credits">${formatDate(t.created_at)}</div>
                </div>
                <div style="color:${t.amount >= 0 ? 'var(--yes)' : 'var(--no)'};font-weight:700">
                    ${t.amount >= 0 ? '+' : ''}${t.amount}
                </div>
            </div>
        `).join('');
    } else {
        content += '<p style="color:var(--text-muted)">Nessuna transazione</p>';
    }

    content += `<button style="margin-top:24px;width:100%;padding:14px;border-radius:12px;border:1px solid var(--border);background:transparent;color:var(--no);font-weight:600;cursor:pointer" id="logout-btn">Esci</button>`;

    document.getElementById('profile-content').innerHTML = content;

    document.getElementById('logout-btn')?.addEventListener('click', async () => {
        await supabaseClient.auth.signOut();
    });
}

// ============ ADMIN ============
window.openAdmin = function() {
    hide('profile-view');
    hide('main-view');
    show('admin-view');
    loadAdminPanel();
};

document.getElementById('back-from-admin').addEventListener('click', () => {
    hide('admin-view');
    show('profile-view');
});

async function loadAdminPanel() {
    const { data: users } = await supabaseClient.from('profiles').select('*').order('credits', { ascending: true });
    const { data: markets } = await supabaseClient.from('markets').select('*').eq('status', 'open');

    let content = `<div class="admin-section"><h3>Utenti (${users?.length || 0})</h3>`;

    if (users) {
        content += users.map(u => `
            <div class="admin-user-row">
                <div>
                    <div class="username">${u.username} ${u.role === 'admin' ? '👑' : ''}</div>
                    <div class="user-credits">${u.credits} crediti</div>
                </div>
                <button onclick="openGrantModal('${u.id}', '${u.username}')">+ Crediti</button>
            </div>
        `).join('');
    }
    content += `</div>`;

    content += `<div class="admin-section"><h3>Mercati aperti (${markets?.length || 0})</h3>`;
    if (markets && markets.length > 0) {
        content += markets.map(m => `
            <div class="admin-market-row">
                <div class="market-q">${m.question}</div>
                <div class="market-actions">
                    <button class="btn-resolve-yes" onclick="resolveMarket('${m.id}', true)">Risolvi YES</button>
                    <button class="btn-resolve-no" onclick="resolveMarket('${m.id}', false)">Risolvi NO</button>
                    <button class="btn-close" onclick="closeMarket('${m.id}')">Chiudi</button>
                </div>
            </div>
        `).join('');
    } else {
        content += '<p style="color:var(--text-muted)">Nessun mercato aperto</p>';
    }
    content += `</div>`;

    document.getElementById('admin-content').innerHTML = content;
}

let grantUserId = null;

window.openGrantModal = function(userId, username) {
    grantUserId = userId;
    document.getElementById('grant-user-name').textContent = `Utente: ${username}`;
    document.getElementById('grant-amount').value = 500;
    document.getElementById('grant-reason').value = '';
    show('grant-modal');
};

document.getElementById('cancel-grant').addEventListener('click', () => hide('grant-modal'));

document.getElementById('confirm-grant').addEventListener('click', async () => {
    const amount = parseInt(document.getElementById('grant-amount').value) || 0;
    const reason = document.getElementById('grant-reason').value.trim() || null;

    const { error } = await supabaseClient.rpc('admin_grant_credits', {
        p_user_id: grantUserId,
        p_amount: amount,
        p_reason: reason
    });

    if (error) { alert(error.message); return; }

    hide('grant-modal');
    loadAdminPanel();
});

window.resolveMarket = async function(marketId, outcome) {
    if (!confirm(`Risolvi questo mercato come ${outcome ? 'YES' : 'NO'}?`)) return;

    const { error } = await supabaseClient.from('markets').update({
        status: 'resolved',
        outcome: outcome,
        resolved_at: new Date().toISOString(),
        resolved_by: currentUser.id
    }).eq('id', marketId);

    if (error) { alert(error.message); return; }

    const { data: positions } = await supabaseClient
        .from('positions')
        .select('*')
        .eq('market_id', marketId)
        .eq('side', outcome);

    if (positions) {
        for (const pos of positions) {
            const payout = Math.floor(Number(pos.shares));
            if (payout > 0) {
                await supabaseClient.rpc('execute_bet', {
                    p_user_id: pos.user_id,
                    p_market_id: marketId,
                    p_side: pos.side,
                    p_shares: 0,
                    p_cost: -payout,
                    p_new_q_yes: 0,
                    p_new_q_no: 0
                }).catch(() => {});
            }
        }
    }

    loadAdminPanel();
};

window.closeMarket = async function(marketId) {
    if (!confirm('Chiudere questo mercato? Non sarà più possibile scommettere.')) return;
    const { error } = await supabaseClient.from('markets').update({ status: 'closed' }).eq('id', marketId);
    if (error) { alert(error.message); return; }
    loadAdminPanel();
};

// ============ CHIUSURA MODALI CLICCANDO FUORI ============
document.querySelectorAll('.modal').forEach(modal => {
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.classList.add('hidden');
        }
    });
});

// ============ PROFILO PUBBLICO ============
document.addEventListener('click', (e) => {
    const target = e.target.closest('[data-user-id]');
    if (target && target.dataset.userId) {
        openUserProfile(target.dataset.userId);
    }
});

window.openUserProfile = async function(userId) {
    if (!userId) return;

    // Traccia la vista di partenza prima di nascondere tutto
    profileReturnView = getCurrentView();

    if (userId === currentUser.id) {
        // Profilo personale
        hide('main-view');
        hide('market-view');
        hide('admin-view');
        hide('public-profile-view');
        show('profile-view');
        await loadProfileView();
        return;
    }

    // Profilo pubblico
    hide('main-view');
    hide('market-view');
    hide('profile-view');
    hide('admin-view');
    show('public-profile-view');
    await loadPublicProfileView(userId);
};

async function loadPublicProfileView(userId) {
    const container = document.getElementById('public-profile-content');
    container.innerHTML = '<p style="text-align:center;color:var(--text-muted);padding:32px">Caricamento...</p>';

    const { data: profile, error } = await supabaseClient
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();

    if (error || !profile) {
        container.innerHTML = '<p style="text-align:center;color:var(--text-muted);padding:32px">Profilo non trovato</p>';
        return;
    }

    const { data: positions } = await supabaseClient
        .from('positions')
        .select('side, shares, markets(status, outcome)')
        .eq('user_id', userId);

    const totalBets = positions?.length || 0;
    const wonPositions = positions?.filter(p =>
        p.markets?.status === 'resolved' &&
        ((p.side === true && p.markets.outcome === true) ||
         (p.side === false && p.markets.outcome === false))
    ).length || 0;
    const winRate = totalBets > 0 ? Math.round((wonPositions / totalBets) * 100) : 0;

    container.innerHTML = `
        <div class="profile-header">
            <div class="profile-avatar">${(profile.username || 'U')[0].toUpperCase()}</div>
            <h2>${profile.username}</h2>
            <p style="color:var(--text-muted);font-size:13px">Iscritto dal ${formatDate(profile.created_at)}</p>
        </div>
        <div class="profile-stats">
            <div class="stat-card">
                <div class="stat-value">${profile.credits}</div>
                <div class="stat-label">Crediti</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${winRate}%</div>
                <div class="stat-label">Win Rate</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${totalBets}</div>
                <div class="stat-label">Scommesse</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${wonPositions}</div>
                <div class="stat-label">Vinte</div>
            </div>
        </div>
        <h3 style="margin:24px 0 12px 0;font-size:16px">Puntate</h3>
        <div class="bet-history-list">${renderBetHistory(positions)}</div>
    `;
}

// Back button: torna alla vista da cui è stato aperto il profilo
document.getElementById('back-from-public-profile').addEventListener('click', () => {
    hide('public-profile-view');
    show(profileReturnView);
});

// Click sulle card puntata → apri il mercato
document.addEventListener('click', (e) => {
    const card = e.target.closest('.bet-history-card');
    if (card && card.dataset.marketId) {
        openMarket(card.dataset.marketId);
    }
});

// ============ INIT ============
initAuth();
