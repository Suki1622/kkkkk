// Coletor de Relíquias - Tribal Wars BR v5 - Versão Bookmarklet
(function() {
    'use strict';

    if (window.relicCollectorRunning) {
        if (!document.getElementById('relic-panel')) iniciarInterface();
        return;
    }
    window.relicCollectorRunning = true;

    // ========== CONFIG ==========
    const CONFIG = {
        concorrencia: 3,
        delayEntreRelatorios: 400,
        delayEntrePaginas: 800,
        timeoutRelatorio: 12000,
        minhasCoords: null,
    };

    // ========== ESTADO ==========
    let scannerAtivo = false;
    let resultadosEncontrados = [];
    let relatoriosProcessados = 0;
    let relatoriosComErro = 0;
    let totalRelatorios = 0;
    let processedReports = [];
    let coletados = new Set();
    let filtroAtivo = { cinza: true, polished: true, refined: true };
    let ordenacao = 'qualidade';
    let modoMultiPagina = true;
    let iframeHolder = null;

    // ========== PERSISTÊNCIA (localStorage) ==========
    function salvar() {
        try {
            localStorage.setItem('relic_v5_results',   JSON.stringify(resultadosEncontrados));
            localStorage.setItem('relic_v5_processed', JSON.stringify(processedReports));
            localStorage.setItem('relic_v5_coletados', JSON.stringify([...coletados]));
            localStorage.setItem('relic_v5_coords',    JSON.stringify(CONFIG.minhasCoords));
        } catch(e) {}
    }

    function carregar() {
        try {
            const r = localStorage.getItem('relic_v5_results');   if (r) resultadosEncontrados = JSON.parse(r);
            const p = localStorage.getItem('relic_v5_processed'); if (p) processedReports      = JSON.parse(p);
            const c = localStorage.getItem('relic_v5_coletados'); if (c) coletados             = new Set(JSON.parse(c));
            const k = localStorage.getItem('relic_v5_coords');    if (k) CONFIG.minhasCoords   = JSON.parse(k);
        } catch(e) {}
    }

    // ========== UTILS ==========
    function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

    function extractReportId(url) {
        const m = url.match(/[?&]view=(\d+)/);
        return m ? m[1] : null;
    }

    function determinarQualidade(nome) {
        const n = (nome || '').toLowerCase();
        if (n.includes('aprimorada') || n.includes('refined')) return 'refined';
        if (n.includes('básica') || n.includes('basica') || n.includes('polished')) return 'polished';
        return 'cinza';
    }

    function qualidadePeso(q) { return q === 'refined' ? 3 : q === 'polished' ? 2 : 1; }

    function calcularDistancia(coords) {
        if (!CONFIG.minhasCoords || !coords) return Infinity;
        const p = coords.split('|');
        if (p.length !== 2) return Infinity;
        const dx = parseInt(p[0]) - CONFIG.minhasCoords.x;
        const dy = parseInt(p[1]) - CONFIG.minhasCoords.y;
        return Math.sqrt(dx * dx + dy * dy);
    }

    function getIcone(nome, q) {
        const s = q === 'refined' ? 'refined' : q === 'polished' ? 'polished' : 'shoddy';
        const nomes   = ['long_sword','sword','shield','armor','helmet','axe','spear','bow','staff','book','crown','sceptre','amulet','ring','chalice','jewel'];
        const palavras= ['espada longa','espada','escudo','armadura','capacete','machado','lança','arco','cajado','livro','coroa','cetro','amuleto','anel','cálice','joia'];
        const n = (nome || '').toLowerCase();
        for (let i = 0; i < palavras.length; i++)
            if (n.includes(palavras[i]))
                return `https://dsbr.innogamescdn.com/asset/c9b60b77/graphic/relic_system/relics_46/relic_${nomes[i]}_${s}.webp`;
        return `https://dsbr.innogamescdn.com/asset/c9b60b77/graphic/relic_system/relics_46/relic_${s}.webp`;
    }

    function getReliquiasFiltradas() {
        let lista = resultadosEncontrados.filter(r => filtroAtivo[determinarQualidade(r.relic)]);
        if (ordenacao === 'distancia' && CONFIG.minhasCoords) {
            lista.sort((a, b) => calcularDistancia(a.defenderCoordinates) - calcularDistancia(b.defenderCoordinates));
        } else if (ordenacao === 'qualidade') {
            lista.sort((a, b) => qualidadePeso(determinarQualidade(b.relic)) - qualidadePeso(determinarQualidade(a.relic)));
        } else {
            lista.reverse();
        }
        return lista;
    }

    // ========== PAGINAÇÃO ==========
    function getPaginasLista() {
        const paginas = new Set();
        paginas.add(window.location.href);
        document.querySelectorAll('a.paged-nav-item').forEach(a => {
            if (a.href && a.href.includes('screen=report')) paginas.add(a.href);
        });
        document.querySelectorAll('a[href*="screen=report"][href*="mode="]').forEach(a => {
            const txt = a.textContent.trim();
            if (/^\d+$/.test(txt)) paginas.add(a.href);
        });
        return [...paginas];
    }

    // ========== FETCH DE PÁGINA DE RELATÓRIOS (usando fetch nativo) ==========
    async function fetchPaginaRelatorios(url) {
        try {
            const response = await fetch(url, { credentials: 'include' });
            if (!response.ok) return { relatorios: [], maisPaginas: [] };
            const html = await response.text();
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');
            const links = doc.querySelectorAll('a[href*="screen=report"][href*="view="]');
            const relatorios = [];
            links.forEach(link => {
                let href = link.getAttribute('href');
                if (href && !href.startsWith('http')) {
                    href = new URL(href, window.location.origin).href;
                } else {
                    href = link.href;
                }
                const id = extractReportId(href);
                if (!id || processedReports.includes(id)) return;
                relatorios.push({ id, url: href });
            });

            const maisPaginas = [];
            doc.querySelectorAll('a.paged-nav-item').forEach(a => {
                const href = a.getAttribute('href');
                if (href) maisPaginas.push(href.startsWith('http') ? href : new URL(href, window.location.origin).href);
            });

            return { relatorios, maisPaginas };
        } catch(e) {
            return { relatorios: [], maisPaginas: [] };
        }
    }

    // ========== FETCH DO RELATÓRIO INDIVIDUAL ==========
    async function fetchRelatorio(relatorio) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), CONFIG.timeoutRelatorio);
            const response = await fetch(relatorio.url, { credentials: 'include', signal: controller.signal });
            clearTimeout(timeoutId);
            
            if (!response.ok) throw new Error('Erro na resposta');
            const html = await response.text();
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');
            const relics = analisarRelatorio(doc, relatorio);
            if (relics.length > 0) {
                resultadosEncontrados.push(...relics);
                atualizarLista();
            }
        } catch(e) {
            relatoriosComErro++;
        }
    }

    // ========== ANÁLISE DO RELATÓRIO ==========
    function extractDefenderCoords(doc) {
        try {
            const links = doc.querySelectorAll('a[href*="info_village"], a[href*="screen=info_village"]');
            for (const l of links) {
                const m = l.textContent.match(/(\d+)\|(\d+)/);
                if (m) return { coordinates: `${m[1]}|${m[2]}`, villageName: l.closest('td')?.textContent?.trim()?.split('\n')[0] || l.textContent.trim() };
            }
            const txt = doc.body?.innerText || doc.body?.textContent || '';
            const pats = [
                /Defensor[^(]*\((\d+)\|(\d+)\)/i,
                /Defender[^(]*\((\d+)\|(\d+)\)/i,
                /Aldeia[^(]*\((\d+)\|(\d+)\)/i,
                /\((\d+)\|(\d+)\)/,
            ];
            for (const p of pats) {
                const m = txt.match(p);
                if (m) return { coordinates: `${m[1]}|${m[2]}`, villageName: 'Desconhecida' };
            }
        } catch(e) {}
        return null;
    }

    function analisarRelatorio(doc, relatorio) {
        const relics   = [];
        const defInfo  = extractDefenderCoords(doc);

        const elementos = doc.querySelectorAll(
            '.relic-quality-shoddy, .relic-quality-polished, .relic-quality-refined, ' +
            '.relic-quality-shoddy.inline-relic, .relic-quality-polished.inline-relic, .relic-quality-refined.inline-relic, ' +
            '[class*="relic-quality"]'
        );

        elementos.forEach(el => {
            const nome = el.textContent.trim();
            if (!nome || nome.length < 3 || nome.length > 100) return;

            let q = 'cinza';
            if (el.classList.contains('relic-quality-refined'))  q = 'refined';
            else if (el.classList.contains('relic-quality-polished')) q = 'polished';
            else q = determinarQualidade(nome);

            const imgEl = el.querySelector('img') || el.closest('td')?.querySelector('img[src*="relic"]');
            const imagemUrl = (imgEl && imgEl.src) ? imgEl.src : getIcone(nome, q);

            if (relics.some(r => r.relic === nome)) return;

            relics.push({
                relic: nome,
                imagemUrl,
                defenderCoordinates: defInfo?.coordinates || null,
                defenderVillage:     defInfo?.villageName || null,
                reportId:   relatorio.id,
                reportUrl:  relatorio.url,
                timestamp:  Date.now(),
                qualidade:  q,
            });
        });

        return relics;
    }

    // ========== FILA DE CONCORRÊNCIA ==========
    async function processarComFila(relatorios, concorrencia) {
        let idx = 0;
        async function worker() {
            while (idx < relatorios.length && scannerAtivo) {
                const rel = relatorios[idx++];
                await fetchRelatorio(rel);
                relatoriosProcessados++;
                processedReports.push(rel.id);
                salvar();
                atualizarPainel();
                if (idx < relatorios.length) await sleep(CONFIG.delayEntreRelatorios);
            }
        }
        const workers = Array.from({ length: Math.min(concorrencia, relatorios.length) }, () => worker());
        await Promise.all(workers);
    }

    // ========== SCANNER PRINCIPAL ==========
    async function iniciarScanner() {
        if (scannerAtivo) { alert('Scanner já está em execução!'); return; }

        const vConc  = parseInt(document.getElementById('relic-concorrencia')?.value) || 3;
        const vDelay = parseInt(document.getElementById('relic-delay')?.value) || 400;
        const vMulti = document.getElementById('relic-multipagina')?.checked ?? true;
        CONFIG.concorrencia          = Math.max(1, Math.min(20, vConc));
        CONFIG.delayEntreRelatorios  = Math.max(200, vDelay);
        modoMultiPagina              = vMulti;

        scannerAtivo          = true;
        relatoriosProcessados = 0;
        relatoriosComErro     = 0;
        totalRelatorios       = 0;
        atualizarPainel();
        setStatus('ATIVO', '#16a34a');

        setProgresso('🔍 A detetar páginas de relatórios...');

        let todasUrls = new Set();
        let todosRelatorios = [];

        if (modoMultiPagina) {
            const paginasListagem = getPaginasLista();
            setProgresso(`📄 ${paginasListagem.length} página(s) detetada(s). A recolher links...`);

            const paginasVistas = new Set();
            const fila = [...paginasListagem];

            while (fila.length > 0 && scannerAtivo) {
                const url = fila.shift();
                if (paginasVistas.has(url)) continue;
                paginasVistas.add(url);

                setProgresso(`📄 A ler página ${paginasVistas.size}/${paginasVistas.size + fila.length}... (${todosRelatorios.length} relatórios até agora)`);

                const { relatorios, maisPaginas } = await fetchPaginaRelatorios(url);

                relatorios.forEach(r => {
                    if (!todasUrls.has(r.id)) {
                        todasUrls.add(r.id);
                        todosRelatorios.push(r);
                    }
                });

                maisPaginas.forEach(p => {
                    if (!paginasVistas.has(p)) fila.push(p);
                });

                await sleep(CONFIG.delayEntrePaginas);
            }
        } else {
            const links = document.querySelectorAll('a[href*="screen=report"][href*="view="]');
            links.forEach(link => {
                const id = extractReportId(link.href);
                if (!id || processedReports.includes(id) || todasUrls.has(id)) return;
                todasUrls.add(id);
                todosRelatorios.push({ id, url: link.href });
            });
        }

        totalRelatorios = todosRelatorios.length;

        if (totalRelatorios === 0) {
            alert('Nenhum relatório novo encontrado!\n\nSe já processaste todos, clica em 🗑️ LIMPAR para recomeçar.');
            scannerAtivo = false;
            atualizarPainel();
            setStatus('INATIVO', '#dc2626');
            return;
        }

        setProgresso(`⚔️ ${totalRelatorios} relatórios encontrados. A processar com ${CONFIG.concorrencia} em paralelo...`);
        atualizarPainel();

        await processarComFila(todosRelatorios, CONFIG.concorrencia);

        scannerAtivo = false;
        salvar();
        atualizarPainel();
        setStatus('INATIVO', '#dc2626');

        const nRel = resultadosEncontrados.length;
        const nRefined = resultadosEncontrados.filter(r => determinarQualidade(r.relic) === 'refined').length;
        setProgresso(`✅ Concluído! ${relatoriosProcessados} relatórios | ${nRel} relíquias (${nRefined} aprimoradas 🔵)`);
    }

    function pararScanner() {
        scannerAtivo = false;
        setProgresso('⏹ Parado pelo utilizador.');
        setStatus('INATIVO', '#dc2626');
        atualizarPainel();
    }

    // ========== UI ==========
    function setStatus(txt, cor) {
        const el = document.getElementById('rp-status');
        if (el) { el.textContent = txt; el.style.background = cor; }
    }

    function setProgresso(msg) {
        const el = document.getElementById('rp-prog-label');
        if (el) el.textContent = msg;
    }

    function atualizarPainel() {
        const pct = totalRelatorios > 0 ? Math.min(100, Math.round(relatoriosProcessados / totalRelatorios * 100)) : 0;
        const set = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
        set('rp-s-proc', relatoriosProcessados);
        set('rp-s-total', totalRelatorios);
        set('rp-s-rel',  resultadosEncontrados.length);
        set('rp-s-col',  coletados.size);
        set('rp-s-err',  relatoriosComErro);
        set('rp-pct', pct + '%');
        const bar = document.getElementById('rp-bar');
        if (bar) bar.style.width = pct + '%';
        atualizarLista();
    }

    function atualizarFiltros() {
        const C = (id, ativo, cor, off) => {
            const b = document.getElementById(id);
            if (!b) return;
            b.style.background  = ativo ? cor : off;
            b.style.borderColor = ativo ? '#fff' : 'transparent';
        };
        C('rp-f-cinza',    filtroAtivo.cinza,    '#6b7280', '#1f2937');
        C('rp-f-polished', filtroAtivo.polished, '#16a34a', '#052e16');
        C('rp-f-refined',  filtroAtivo.refined,  '#2563eb', '#0a1a4a');
    }

    function atualizarOrdenacao() {
        ['tempo', 'qualidade', 'distancia'].forEach(o => {
            const b = document.getElementById(`rp-ord-${o}`);
            if (b) { b.style.background = ordenacao === o ? '#4a4a6a' : '#222235'; b.style.color = ordenacao === o ? '#ffd700' : '#9ca3af'; }
        });
    }

    function atualizarLista() {
        const container = document.getElementById('rp-lista');
        const contador  = document.getElementById('rp-contador');
        if (!container) return;

        const hideCol = document.getElementById('rp-hide-coletados')?.checked;
        let lista = getReliquiasFiltradas();
        if (hideCol) lista = lista.filter(r => !coletados.has(r.reportId + '_' + r.relic));
        if (contador) contador.textContent = lista.length;

        if (lista.length === 0) {
            container.innerHTML = `<div style="text-align:center;padding:55px 20px;background:#181828;border-radius:12px;border:2px dashed #252540;">
                <div style="font-size:42px;opacity:0.3;margin-bottom:12px;">🔍</div>
                <div style="color:#64748b;font-size:14px;">Nenhuma relíquia encontrada</div>
                <div style="font-size:12px;color:#374151;margin-top:5px;">Inicia o scanner para varrer os relatórios</div>
            </div>`;
            return;
        }

        container.innerHTML = lista.map(rel => {
            const q     = determinarQualidade(rel.relic);
            const cor   = q === 'refined' ? '#3b82f6' : q === 'polished' ? '#22c55e' : '#6b7280';
            const emoji = q === 'refined' ? '🔵' : q === 'polished' ? '🟢' : '⚪';
            const coords = rel.defenderCoordinates || 'N/A';
            const vila   = rel.defenderVillage || '—';
            const img    = rel.imagemUrl || getIcone(rel.relic, q);
            const uid    = rel.reportId + '_' + rel.relic;
            const isCol  = coletados.has(uid);
            const dist   = CONFIG.minhasCoords ? calcularDistancia(coords) : null;
            const distStr = (dist && dist !== Infinity) ? `<span style="color:#f97316;font-size:11px;">📏 ${dist.toFixed(1)}</span>` : '';
            const [cx, cy] = coords !== 'N/A' ? coords.split('|') : [null, null];
            const mapUrl = cx ? `https://br140.tribalwars.com.br/game.php?screen=map&x=${cx}&y=${cy}` : null;

            return `<div class="rp-card${isCol ? ' coletado' : ''}" style="border-left:5px solid ${cor};margin-bottom:9px;padding:11px 13px;background:#131323;border-radius:10px;display:flex;gap:12px;align-items:center;transition:transform .12s,opacity .2s;position:relative;${isCol ? 'opacity:.38;' : ''}" data-uid="${uid}">
                ${isCol ? '<div style="position:absolute;top:50%;right:54px;transform:translateY(-50%);color:#22c55e;font-size:10px;font-weight:700;letter-spacing:1px;pointer-events:none;">✅ COLETADO</div>' : ''}
                <div style="flex-shrink:0;position:relative;cursor:pointer;" onclick="window.relicToggle('${uid}')" title="Marcar como coletada">
                    <img src="${img}" style="width:44px;height:44px;border-radius:7px;border:2px solid ${cor};background:#0c0c18;padding:3px;" onerror="this.style.display='none'">
                    <span style="position:absolute;top:-5px;right:-5px;font-size:12px;">${emoji}</span>
                </div>
                <div style="flex:1;min-width:0;">
                    <div style="display:flex;justify-content:space-between;margin-bottom:4px;gap:8px;">
                        <span style="font-weight:700;color:${cor};font-size:13px;">${rel.relic}</span>
                        <span style="font-size:11px;color:#4a5568;flex-shrink:0;">${new Date(rel.timestamp).toLocaleTimeString()}</span>
                    </div>
                    <div style="font-size:12px;display:flex;gap:10px;flex-wrap:wrap;align-items:center;">
                        ${mapUrl ? `<a href="${mapUrl}" target="_blank" style="color:#22c55e;font-weight:700;text-decoration:none;">📍 ${coords}</a>` : `<span style="color:#22c55e;font-weight:700;">📍 ${coords}</span>`}
                        <span style="color:#9ca3af;">🏘️ ${vila}</span>
                        ${distStr}
                        <a href="${rel.reportUrl || '#'}" target="_blank" style="color:#4a5568;font-size:11px;text-decoration:none;" title="Ver relatório original">🆔 #${rel.reportId}</a>
                    </div>
                </div>
                <button onclick="window.relicToggle('${uid}')" title="${isCol ? 'Desmarcar' : 'Marcar como coletada'}"
                    style="flex-shrink:0;background:${isCol ? '#14532d' : '#1f2937'};border:none;border-radius:7px;padding:6px 10px;cursor:pointer;font-size:13px;color:${isCol ? '#22c55e' : '#64748b'};">
                    ${isCol ? '✅' : '☐'}
                </button>
            </div>`;
        }).join('');
    }

    window.relicToggle = function(uid) {
        if (coletados.has(uid)) coletados.delete(uid);
        else coletados.add(uid);
        salvar();
        atualizarPainel();
    };

    // ========== CRIAR PAINEL ==========
    function iniciarInterface() {
        carregar();

        if (!document.getElementById('relic-styles')) {
            const s = document.createElement('style');
            s.id = 'relic-styles';
            s.textContent = `
            #relic-panel {
                position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);
                width:1040px;max-width:97vw;height:820px;max-height:94vh;
                background:#0c0c18;color:#e2e8f0;
                border-radius:16px;border:1px solid #252545;
                box-shadow:0 0 0 1px rgba(255,215,0,.12) inset,0 28px 70px rgba(0,0,0,.9);
                z-index:9999999;display:flex;flex-direction:column;
                overflow:hidden;font-family:'Segoe UI',system-ui,sans-serif;resize:both;
            }
            .rp-header{padding:13px 20px;background:#111122;border-bottom:2px solid #c9930a;display:flex;align-items:center;gap:11px;flex-shrink:0;}
            .rp-body{flex:1;overflow-y:auto;padding:16px 20px;}
            .rp-body::-webkit-scrollbar{width:5px;}
            .rp-body::-webkit-scrollbar-thumb{background:#3a3a5a;border-radius:3px;}
            .rp-footer{padding:11px 20px;background:#111122;border-top:2px solid #c9930a;display:flex;gap:7px;flex-wrap:wrap;flex-shrink:0;}
            .rp-stat{background:#181828;border:1px solid #222240;border-radius:10px;padding:11px;text-align:center;flex:1;}
            .rp-stat-n{font-size:22px;font-weight:700;}
            .rp-stat-l{font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:.8px;margin-top:2px;}
            .rp-btn{border:none;border-radius:9px;cursor:pointer;font-weight:700;font-size:12px;padding:9px 13px;
                display:flex;align-items:center;justify-content:center;gap:5px;transition:opacity .15s,transform .1s;white-space:nowrap;}
            .rp-btn:hover{opacity:.82;transform:translateY(-1px);}
            .rp-card-list{min-height:120px;max-height:290px;overflow-y:auto;padding-right:2px;}
            .rp-card-list::-webkit-scrollbar{width:4px;}
            .rp-card-list::-webkit-scrollbar-thumb{background:#3a3a5a;border-radius:2px;}
            .rp-cfg{display:flex;align-items:center;gap:9px;background:#181828;border:1px solid #222240;
                border-radius:10px;padding:10px 14px;margin-bottom:13px;flex-wrap:wrap;}
            .rp-inp{background:#0c0c18;color:#ffd700;border:1px solid #3a3a5a;border-radius:6px;
                padding:5px 9px;font-size:14px;font-weight:700;text-align:center;}
            .rp-inp:focus{outline:none;border-color:#c9930a;}
            .rp-inp-sm{background:#0c0c18;color:#9ca3af;border:1px solid #3a3a5a;border-radius:6px;
                padding:5px 9px;font-size:12px;text-align:center;}
            .rp-filt{flex:1;min-width:95px;padding:8px 9px;border:2px solid transparent;border-radius:8px;
                cursor:pointer;font-weight:700;font-size:12px;display:flex;align-items:center;justify-content:center;gap:5px;transition:all .15s;}
            .rp-bar-wrap{height:8px;background:#0c0c18;border-radius:4px;overflow:hidden;margin-top:5px;}
            .rp-bar-fill{height:100%;background:linear-gradient(90deg,#16a34a,#86efac);border-radius:4px;transition:width .3s;}
            .rp-sep{height:1px;background:#1a1a30;margin:12px 0;}
            .rp-check{accent-color:#ffd700;width:15px;height:15px;cursor:pointer;}
            @keyframes rpIn{from{opacity:0;transform:translateX(-10px)}to{opacity:1;transform:translateX(0)}}
            `;
            document.head.appendChild(s);
        }
        criarPainel();
    }

    function criarPainel() {
        document.getElementById('relic-panel')?.remove();

        const coordsStr = CONFIG.minhasCoords ? `${CONFIG.minhasCoords.x}|${CONFIG.minhasCoords.y}` : '';
        const p = document.createElement('div');
        p.id = 'relic-panel';

        p.innerHTML = `
        <div class="rp-header">
            <span style="font-size:19px;">⚔️</span>
            <span style="font-size:17px;font-weight:700;color:#ffd700;flex:1;">Coletor de Relíquias <span style="font-size:12px;color:#64748b;">v5</span></span>
            <span id="rp-status" style="font-size:11px;padding:3px 11px;background:#dc2626;color:#fff;border-radius:20px;font-weight:700;">INATIVO</span>
            <button id="rp-close" style="margin-left:9px;background:#1f1f35;border:none;color:#9ca3af;font-size:15px;cursor:pointer;width:28px;height:28px;border-radius:6px;">✖</button>
        </div>

        <div class="rp-body">

            <!-- Stats -->
            <div style="display:flex;gap:8px;margin-bottom:13px;">
                <div class="rp-stat"><div class="rp-stat-n" id="rp-s-proc" style="color:#22c55e;">0</div><div class="rp-stat-l">Processados</div></div>
                <div class="rp-stat"><div class="rp-stat-n" id="rp-s-total" style="color:#9ca3af;">0</div><div class="rp-stat-l">Total</div></div>
                <div class="rp-stat"><div class="rp-stat-n" id="rp-s-rel"  style="color:#ffd700;">0</div><div class="rp-stat-l">Relíquias</div></div>
                <div class="rp-stat"><div class="rp-stat-n" id="rp-s-col"  style="color:#22c55e;">0</div><div class="rp-stat-l">Coletadas</div></div>
                <div class="rp-stat"><div class="rp-stat-n" id="rp-s-err"  style="color:#ef4444;">0</div><div class="rp-stat-l">Erros</div></div>
            </div>

            <!-- Config -->
            <div class="rp-cfg">
                <span style="color:#ffd700;font-weight:700;font-size:12px;">⚙️</span>
                <span style="color:#64748b;font-size:11px;">Paralelo:</span>
                <input type="number" id="relic-concorrencia" class="rp-inp" style="width:55px;" min="1" max="15" value="${CONFIG.concorrencia}" title="Relatórios em simultâneo">
                <span style="color:#64748b;font-size:11px;">Delay(ms):</span>
                <input type="number" id="relic-delay" class="rp-inp-sm" style="width:72px;" min="200" max="5000" step="100" value="${CONFIG.delayEntreRelatorios}">
                <label style="display:flex;align-items:center;gap:5px;color:#9ca3af;font-size:11px;cursor:pointer;">
                    <input type="checkbox" id="relic-multipagina" class="rp-check" ${modoMultiPagina ? 'checked' : ''}> Todas as páginas
                </label>
                <div style="display:flex;align-items:center;gap:5px;margin-left:auto;">
                    <span style="color:#64748b;font-size:11px;">Minhas coords:</span>
                    <input type="text" id="relic-coords" class="rp-inp-sm" style="width:80px;" placeholder="500|500" value="${coordsStr}">
                    <button id="rp-coords-save" class="rp-btn" style="background:#2a2a45;color:#ffd700;padding:5px 10px;">💾</button>
                </div>
            </div>

            <!-- Filtros + Ordenação -->
            <div style="display:flex;gap:7px;margin-bottom:13px;flex-wrap:wrap;">
                <button id="rp-f-cinza"    class="rp-filt" style="background:#6b7280;color:#fff;">⚪ Má Qual.</button>
                <button id="rp-f-polished" class="rp-filt" style="background:#16a34a;color:#fff;">🟢 Básica</button>
                <button id="rp-f-refined"  class="rp-filt" style="background:#2563eb;color:#fff;">🔵 Aprimorada</button>
                <button id="rp-f-todos"    class="rp-filt" style="background:#3b3b5a;color:#ffd700;border-color:#ffd700;border-style:solid;">✨ Todos</button>
                <div style="margin-left:auto;display:flex;gap:5px;">
                    <button id="rp-ord-qualidade"  class="rp-btn" style="background:#4a4a6a;color:#ffd700;padding:6px 9px;font-size:11px;">⭐ Qualidade</button>
                    <button id="rp-ord-distancia"  class="rp-btn" style="background:#222235;color:#9ca3af;padding:6px 9px;font-size:11px;">📍 Distância</button>
                    <button id="rp-ord-tempo"      class="rp-btn" style="background:#222235;color:#9ca3af;padding:6px 9px;font-size:11px;">🕐 Recentes</button>
                </div>
            </div>

            <!-- Progresso -->
            <div style="background:#181828;border:1px solid #222240;border-radius:9px;padding:11px 14px;margin-bottom:13px;">
                <div style="display:flex;justify-content:space-between;margin-bottom:4px;">
                    <span style="color:#ffd700;font-weight:700;font-size:12px;">📊 Progresso</span>
                    <span id="rp-pct" style="color:#22c55e;font-weight:700;font-size:12px;">0%</span>
                </div>
                <div class="rp-bar-wrap"><div id="rp-bar" class="rp-bar-fill" style="width:0%"></div></div>
                <div id="rp-prog-label" style="font-size:11px;color:#64748b;margin-top:5px;">Aguardando início...</div>
            </div>

            <!-- Lista -->
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:9px;">
                <span style="font-weight:700;color:#ffd700;font-size:13px;">
                    📋 Relíquias
                    <span id="rp-contador" style="background:#222240;padding:1px 9px;border-radius:20px;font-size:11px;color:#9ca3af;margin-left:5px;">0</span>
                </span>
                <label style="display:flex;align-items:center;gap:5px;font-size:11px;color:#64748b;cursor:pointer;">
                    <input type="checkbox" id="rp-hide-coletados" class="rp-check"> Ocultar coletadas
                </label>
            </div>
            <div id="rp-lista" class="rp-card-list"></div>

        </div>

        <div class="rp-footer">
            <button id="rp-iniciar"   class="rp-btn" style="flex:2;background:#16a34a;color:#fff;font-size:13px;">▶ INICIAR</button>
            <button id="rp-parar"     class="rp-btn" style="flex:1;background:#dc2626;color:#fff;">⏹ PARAR</button>
            <button id="rp-relatorio" class="rp-btn" style="flex:1;background:#7c3aed;color:#fff;">📊 RELATÓRIO</button>
            <button id="rp-bbcode"    class="rp-btn" style="flex:1;background:#0369a1;color:#fff;">🔗 BB CODE</button>
            <button id="rp-copiar"    class="rp-btn" style="flex:1;background:#d97706;color:#fff;">📋 COPIAR</button>
            <button id="rp-limpar"    class="rp-btn" style="flex:1;background:#374151;color:#9ca3af;">🗑️ LIMPAR</button>
        </div>
        `;

        document.body.appendChild(p);

        // Eventos
        document.getElementById('rp-close').onclick    = () => p.remove();
        document.getElementById('rp-iniciar').onclick  = iniciarScanner;
        document.getElementById('rp-parar').onclick    = pararScanner;
        document.getElementById('rp-relatorio').onclick= abrirRelatorio;
        document.getElementById('rp-bbcode').onclick   = abrirBBCode;
        document.getElementById('rp-copiar').onclick   = copiarResultados;
        document.getElementById('rp-limpar').onclick   = limparCache;

        document.getElementById('rp-coords-save').onclick = () => {
            const v = document.getElementById('relic-coords').value.trim();
            const m = v.match(/^(\d+)\|(\d+)$/);
            if (m) { CONFIG.minhasCoords = { x: parseInt(m[1]), y: parseInt(m[2]) }; salvar(); atualizarLista(); alert(`✅ ${v} guardado!`); }
            else alert('Formato: 500|500');
        };

        document.getElementById('rp-f-cinza').onclick    = () => { filtroAtivo.cinza    = !filtroAtivo.cinza;    atualizarFiltros(); atualizarLista(); };
        document.getElementById('rp-f-polished').onclick = () => { filtroAtivo.polished = !filtroAtivo.polished; atualizarFiltros(); atualizarLista(); };
        document.getElementById('rp-f-refined').onclick  = () => { filtroAtivo.refined  = !filtroAtivo.refined;  atualizarFiltros(); atualizarLista(); };
        document.getElementById('rp-f-todos').onclick    = () => { filtroAtivo.cinza = filtroAtivo.polished = filtroAtivo.refined = true; atualizarFiltros(); atualizarLista(); };

        document.getElementById('rp-ord-tempo').onclick     = () => { ordenacao = 'tempo';     atualizarOrdenacao(); atualizarLista(); };
        document.getElementById('rp-ord-qualidade').onclick = () => { ordenacao = 'qualidade'; atualizarOrdenacao(); atualizarLista(); };
        document.getElementById('rp-ord-distancia').onclick = () => {
            if (!CONFIG.minhasCoords) { alert('Define as tuas coordenadas primeiro!'); return; }
            ordenacao = 'distancia'; atualizarOrdenacao(); atualizarLista();
        };

        document.getElementById('rp-hide-coletados').onchange = () => atualizarLista();

        atualizarFiltros();
        atualizarOrdenacao();
        atualizarPainel();
    }

    // ========== RELATÓRIO COMPLETO ==========
    function abrirRelatorio() {
        if (resultadosEncontrados.length === 0) { alert('Nenhuma relíquia encontrada ainda.'); return; }

        const todos = resultadosEncontrados;
        const grupos = { refined: [], polished: [], cinza: [] };
        todos.forEach(r => grupos[determinarQualidade(r.relic)].push(r));

        const porAldeia = {};
        todos.forEach(r => {
            const k = r.defenderCoordinates || 'Desconhecida';
            if (!porAldeia[k]) porAldeia[k] = { coords: k, vila: r.defenderVillage || '—', reliquias: [], coletadas: 0 };
            porAldeia[k].reliquias.push(r);
            if (coletados.has(r.reportId + '_' + r.relic)) porAldeia[k].coletadas++;
        });

        const aldeias = Object.values(porAldeia).sort((a, b) => {
            const ra = a.reliquias.filter(r => determinarQualidade(r.relic) === 'refined').length;
            const rb = b.reliquias.filter(r => determinarQualidade(r.relic) === 'refined').length;
            return rb !== ra ? rb - ra : b.reliquias.length - a.reliquias.length;
        });

        const porTipo = {};
        todos.forEach(r => {
            const q    = determinarQualidade(r.relic);
            const base = r.relic.replace(/(má qualidade|básica|aprimorada|shoddy|polished|refined)/gi, '').trim() || r.relic;
            if (!porTipo[base]) porTipo[base] = { refined: 0, polished: 0, cinza: 0 };
            porTipo[base][q]++;
        });
        const tipos = Object.entries(porTipo).sort((a, b) =>
            (b[1].refined*3 + b[1].polished*2 + b[1].cinza) - (a[1].refined*3 + a[1].polished*2 + a[1].cinza)
        );

        const win = window.open('', '_blank', 'width=1150,height=800,scrollbars=yes');
        const refCoord = CONFIG.minhasCoords ? `${CONFIG.minhasCoords.x}|${CONFIG.minhasCoords.y}` : null;

        win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8">
<title>Relíquias — TW BR</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Segoe UI',system-ui,sans-serif;background:#0c0c18;color:#e2e8f0;padding:22px;font-size:13px;}
h1{color:#ffd700;font-size:20px;border-bottom:2px solid #c9930a;padding-bottom:10px;margin-bottom:14px;}
h2{color:#ffd700;font-size:14px;margin:20px 0 9px;display:flex;align-items:center;gap:7px;}
.stats{display:flex;gap:10px;margin-bottom:18px;flex-wrap:wrap;}
.stat{background:#181828;border:1px solid #222240;border-radius:9px;padding:12px 16px;text-align:center;flex:1;min-width:90px;}
.stat-n{font-size:24px;font-weight:700;}
.stat-l{font-size:10px;color:#64748b;margin-top:2px;}
.badge{display:inline-flex;align-items:center;gap:3px;padding:2px 8px;border-radius:20px;font-size:11px;font-weight:700;}
.refined{background:#1e3a8a;color:#93c5fd;}
.polished{background:#14532d;color:#86efac;}
.cinza{background:#1f2937;color:#9ca3af;}
.tipos{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:7px;margin-bottom:6px;}
.tipo-row{background:#181828;border:1px solid #222240;border-radius:7px;padding:8px 12px;display:flex;align-items:center;gap:8px;}
.aldeia{background:#181828;border:1px solid #222240;border-radius:10px;margin-bottom:12px;overflow:hidden;}
.aldeia-h{padding:10px 14px;background:#1a1a30;display:flex;align-items:center;gap:10px;flex-wrap:wrap;}
.aldeia-coords{color:#22c55e;font-weight:700;font-size:14px;}
.aldeia-body{padding:10px 14px;display:flex;flex-direction:column;gap:6px;}
.rel-row{display:flex;align-items:center;gap:9px;padding:6px 9px;background:#111120;border-radius:6px;}
.rel-row.col{opacity:.4;}
table{width:100%;border-collapse:collapse;background:#181828;border-radius:9px;overflow:hidden;}
th{background:#1a1a30;color:#ffd700;padding:9px 11px;text-align:left;font-size:11px;}
td{padding:7px 11px;border-bottom:1px solid #181830;font-size:12px;}
tr:hover td{background:#161628;}
a{color:inherit;text-decoration:none;}
a:hover{text-decoration:underline;}
.tip{background:#181828;border:1px solid #c9930a;border-radius:7px;padding:11px;font-size:12px;color:#94a3b8;margin-top:16px;}
@media print{body{background:#fff;color:#000;}}
</style></head><body>
<h1>⚔️ Relatório de Relíquias — Tribal Wars BR</h1>
<p style="color:#64748b;font-size:12px;margin-bottom:14px;">
  ${new Date().toLocaleString()} &nbsp;·&nbsp;
  ${relatoriosProcessados} relatórios verificados &nbsp;·&nbsp;
  ${aldeias.length} aldeias com relíquias
  ${refCoord ? ` &nbsp;·&nbsp; Referência: ${refCoord}` : ''}
</p>

<div class="stats">
  <div class="stat"><div class="stat-n" style="color:#3b82f6;">${grupos.refined.length}</div><div class="stat-l">🔵 Aprimoradas</div></div>
  <div class="stat"><div class="stat-n" style="color:#22c55e;">${grupos.polished.length}</div><div class="stat-l">🟢 Básicas</div></div>
  <div class="stat"><div class="stat-n" style="color:#9ca3af;">${grupos.cinza.length}</div><div class="stat-l">⚪ Má Qualidade</div></div>
  <div class="stat"><div class="stat-n" style="color:#ffd700;">${todos.length}</div><div class="stat-l">Total</div></div>
  <div class="stat"><div class="stat-n" style="color:#22c55e;">${coletados.size}</div><div class="stat-l">✅ Coletadas</div></div>
  <div class="stat"><div class="stat-n" style="color:#f97316;">${aldeias.length}</div><div class="stat-l">🏘️ Aldeias</div></div>
</div>

<h2>📊 Por Tipo</h2>
<div class="tipos">
${tipos.map(([tipo, d]) => `
  <div class="tipo-row">
    <span style="flex:1;font-weight:600;">${tipo}</span>
    ${d.refined  > 0 ? `<span class="badge refined">🔵 ${d.refined}x</span>`  : ''}
    ${d.polished > 0 ? `<span class="badge polished">🟢 ${d.polished}x</span>` : ''}
    ${d.cinza    > 0 ? `<span class="badge cinza">⚪ ${d.cinza}x</span>`       : ''}
  </div>`).join('')}
</div>

<h2>🏘️ Por Aldeia <span style="font-size:11px;color:#64748b;font-weight:400;">— ordenado por aprimoradas primeiro</span></h2>
${aldeias.map(al => {
    const nR = al.reliquias.filter(r => determinarQualidade(r.relic) === 'refined').length;
    const nP = al.reliquias.filter(r => determinarQualidade(r.relic) === 'polished').length;
    const nC = al.reliquias.filter(r => determinarQualidade(r.relic) === 'cinza').length;
    const dist = CONFIG.minhasCoords ? calcularDistancia(al.coords) : null;
    const [cx, cy] = al.coords !== 'Desconhecida' ? al.coords.split('|') : [null,null];
    const mapUrl = cx ? `https://br140.tribalwars.com.br/game.php?screen=map&x=${cx}&y=${cy}` : null;
    return `
  <div class="aldeia">
    <div class="aldeia-h">
      ${mapUrl ? `<a href="${mapUrl}" target="_blank" class="aldeia-coords">${al.coords}</a>` : `<span class="aldeia-coords">${al.coords}</span>`}
      <span style="color:#9ca3af;">🏘️ ${al.vila}</span>
      ${nR > 0 ? `<span class="badge refined">🔵 ${nR}</span>`  : ''}
      ${nP > 0 ? `<span class="badge polished">🟢 ${nP}</span>` : ''}
      ${nC > 0 ? `<span class="badge cinza">⚪ ${nC}</span>`     : ''}
      ${dist && dist !== Infinity ? `<span style="color:#f97316;font-size:11px;">📏 ${dist.toFixed(1)} campos</span>` : ''}
      ${al.coletadas > 0 ? `<span style="color:#22c55e;font-size:11px;">✅ ${al.coletadas}/${al.reliquias.length}</span>` : ''}
    </div>
    <div class="aldeia-body">
      ${al.reliquias.sort((a,b) => qualidadePeso(determinarQualidade(b.relic)) - qualidadePeso(determinarQualidade(a.relic))).map(r => {
          const q   = determinarQualidade(r.relic);
          const cor = q === 'refined' ? '#3b82f6' : q === 'polished' ? '#22c55e' : '#6b7280';
          const uid = r.reportId + '_' + r.relic;
          const isC = coletados.has(uid);
          return `<div class="rel-row ${isC ? 'col' : ''}" style="border-left:3px solid ${cor};">
            <img src="${r.imagemUrl || getIcone(r.relic, q)}" style="width:28px;height:28px;border-radius:5px;background:#0c0c18;" onerror="this.style.display='none'">
            <span style="flex:1;color:${cor};font-weight:600;">${r.relic}</span>
            ${isC ? '<span style="color:#22c55e;font-size:11px;">✅ coletada</span>' : ''}
            <a href="${r.reportUrl || '#'}" target="_blank" style="color:#4a5568;font-size:10px;">#${r.reportId}</a>
          </div>`;
      }).join('')}
    </div>
  </div>`;
}).join('')}

<h2>📋 Lista Completa <span style="font-size:11px;color:#64748b;font-weight:400;">— ordenado por qualidade</span></h2>
<table>
  <thead><tr>
    <th>#</th><th>Relíquia</th><th>Qualidade</th><th>Coordenadas</th><th>Vila</th>
    ${CONFIG.minhasCoords ? '<th>Distância</th>' : ''}
    <th>Status</th><th>Relatório</th>
  </tr></thead>
  <tbody>
  ${[...todos].sort((a,b) => qualidadePeso(determinarQualidade(b.relic)) - qualidadePeso(determinarQualidade(a.relic))).map((r, i) => {
      const q    = determinarQualidade(r.relic);
      const cor  = q === 'refined' ? '#3b82f6' : q === 'polished' ? '#22c55e' : '#6b7280';
      const lbl  = q === 'refined' ? 'Aprimorada' : q === 'polished' ? 'Básica' : 'Má Qualidade';
      const e    = q === 'refined' ? '🔵' : q === 'polished' ? '🟢' : '⚪';
      const coords = r.defenderCoordinates || 'N/A';
      const vila   = r.defenderVillage || '—';
      const uid    = r.reportId + '_' + r.relic;
      const dist   = CONFIG.minhasCoords ? calcularDistancia(coords) : null;
      const [cx2, cy2] = coords !== 'N/A' ? coords.split('|') : [null, null];
      const mapUrl2 = cx2 ? `https://br140.tribalwars.com.br/game.php?screen=map&x=${cx2}&y=${cy2}` : null;
      return `<tr>
        <td style="color:#4a5568;">${i+1}</td>
        <td style="color:${cor};font-weight:600;">${r.relic}</td>
        <td><span class="badge ${q}">${e} ${lbl}</span></td>
        <td>${mapUrl2 ? `<a href="${mapUrl2}" target="_blank" style="color:#22c55e;font-weight:700;">${coords}</a>` : `<span style="color:#22c55e;font-weight:700;">${coords}</span>`}</td>
        <td style="color:#9ca3af;">${vila}</td>
        ${CONFIG.minhasCoords ? `<td style="color:#f97316;">${dist && dist !== Infinity ? dist.toFixed(1) : '—'}</td>` : ''}
        <td>${coletados.has(uid) ? '<span style="color:#22c55e;">✅</span>' : '<span style="color:#4a5568;">—</span>'}</td>
        <td><a href="${r.reportUrl || '#'}" target="_blank" style="color:#4a5568;">#${r.reportId}</a></td>
      </tr>`;
  }).join('')}
  </tbody>
</table>
<div class="tip">💡 <b style="color:#ffd700;">Prioridade:</b> Aprimoradas 🔵 &gt; Básicas 🟢 &gt; Má Qualidade ⚪ · Mais próximas primeiro · Clica nas coordenadas para ir ao mapa · Clica no ID para ver o relatório original</div>
</body></html>`);
        win.document.close();
    }

    // ========== BB CODE ==========
    function abrirBBCode() {
        const disponiveis = getReliquiasFiltradas().filter(r => !coletados.has(r.reportId + '_' + r.relic));
        if (disponiveis.length === 0) { alert('Nenhuma relíquia disponível com os filtros atuais.'); return; }

        const porCoords = {};
        disponiveis.forEach(r => {
            const k = r.defenderCoordinates || 'Desconhecida';
            if (!porCoords[k]) porCoords[k] = { coords: k, reliquias: [] };
            porCoords[k].reliquias.push(r);
        });

        const aldeias = Object.values(porCoords).sort((a, b) => {
            const ra = a.reliquias.filter(r => determinarQualidade(r.relic) === 'refined').length;
            const rb = b.reliquias.filter(r => determinarQualidade(r.relic) === 'refined').length;
            return rb - ra;
        });

        let bb = `[b]⚔️ Relíquias Disponíveis — ${new Date().toLocaleDateString()}[/b]\n`;
        bb += `[b]${disponiveis.length} relíquias | ${aldeias.length} aldeias[/b]\n\n`;

        aldeias.forEach(al => {
            if (al.coords === 'Desconhecida') return;
            const [x, y] = al.coords.split('|');
            const dist = CONFIG.minhasCoords ? calcularDistancia(al.coords) : null;
            const distStr = dist && dist !== Infinity ? ` (${dist.toFixed(0)} campos)` : '';
            bb += `[coord]${x}|${y}[/coord]${distStr}: `;
            al.reliquias.sort((a,b) => qualidadePeso(determinarQualidade(b.relic)) - qualidadePeso(determinarQualidade(a.relic))).forEach(r => {
                const e = determinarQualidade(r.relic) === 'refined' ? '🔵' : determinarQualidade(r.relic) === 'polished' ? '🟢' : '⚪';
                bb += `${e} ${r.relic}  `;
            });
            bb += '\n';
        });

        bb += `\n[i]Coletor de Relíquias v5 — ${new Date().toLocaleString()}[/i]`;

        const win = window.open('', '_blank', 'width=720,height=480');
        win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>BB Code</title>
<style>body{font-family:monospace;background:#0c0c18;color:#e2e8f0;padding:22px;}
h2{color:#ffd700;margin-bottom:12px;font-family:'Segoe UI',sans-serif;}
textarea{width:100%;height:300px;background:#181828;color:#e2e8f0;border:1px solid #3a3a5a;border-radius:7px;padding:12px;font-family:monospace;font-size:12px;resize:vertical;}
button{margin-top:10px;padding:9px 20px;background:#0369a1;color:#fff;border:none;border-radius:7px;cursor:pointer;font-weight:700;font-family:'Segoe UI',sans-serif;}
p{color:#64748b;font-size:12px;font-family:'Segoe UI',sans-serif;margin-bottom:9px;}</style>
</head><body>
<h2>🔗 BB Code para o Fórum / Chat da Tribo</h2>
<p>Pronto a colar directamente no fórum ou mensagens do Tribal Wars:</p>
<textarea id="bb">${bb}</textarea>
<button onclick="navigator.clipboard.writeText(document.getElementById('bb').value).then(()=>this.textContent='✅ Copiado!').catch(()=>alert('Seleciona o texto manualmente'))">📋 Copiar tudo</button>
</body></html>`);
        win.document.close();
    }

    // ========== COPIAR ==========
    function copiarResultados() {
        const lista = getReliquiasFiltradas();
        if (lista.length === 0) { alert('Nenhum resultado.'); return; }
        let txt = `⚔️ RELÍQUIAS — TW BR\n${'═'.repeat(44)}\n${new Date().toLocaleString()} | ${lista.length} relíquias\n${'═'.repeat(44)}\n\n`;
        lista.forEach((r, i) => {
            const q   = determinarQualidade(r.relic);
            const e   = q === 'refined' ? '🔵' : q === 'polished' ? '🟢' : '⚪';
            const dist = CONFIG.minhasCoords ? ` | 📏 ${calcularDistancia(r.defenderCoordinates).toFixed(1)}` : '';
            txt += `${e} ${i+1}. ${r.relic}\n   📍 ${r.defenderCoordinates || 'N/A'}  🏘️ ${r.defenderVillage || '—'}${dist}\n   🆔 #${r.reportId}\n\n`;
        });
        navigator.clipboard.writeText(txt).then(() => alert('✅ Copiado!')).catch(() => prompt('Copia:', txt));
    }

    // ========== LIMPAR ==========
    function limparCache() {
        if (!confirm('⚠️ Apagar todos os resultados, histórico e marcações?')) return;
        ['relic_v5_results','relic_v5_processed','relic_v5_coletados'].forEach(k => { try { localStorage.removeItem(k); } catch(e){} });
        resultadosEncontrados = []; processedReports = []; coletados = new Set();
        relatoriosProcessados = relatoriosComErro = totalRelatorios = 0;
        atualizarPainel();
        setProgresso('Cache limpo. Pronto para novo scan.');
        alert('✅ Limpo!');
    }

    // ========== BOTÃO FLUTUANTE ==========
    function criarBotao() {
        if (document.getElementById('relic-fab')) return;
        const btn = document.createElement('button');
        btn.id = 'relic-fab';
        btn.textContent = '⚔️ Relíquias';
        btn.style.cssText = 'position:fixed;bottom:20px;right:20px;background:linear-gradient(135deg,#b8860b,#ffd700);color:#0c0c18;border:none;border-radius:50px;padding:11px 20px;font-size:13px;font-weight:700;cursor:pointer;z-index:9999998;box-shadow:0 4px 16px rgba(184,134,11,.5);transition:transform .18s,box-shadow .18s;font-family:"Segoe UI",sans-serif;';
        btn.onmouseover = () => { btn.style.transform='scale(1.06)'; };
        btn.onmouseout  = () => { btn.style.transform='scale(1)'; };
        btn.onclick = () => {
            if (document.getElementById('relic-panel')) document.getElementById('relic-panel').remove();
            else criarPainel();
        };
        document.body.appendChild(btn);
    }

    // ========== INIT ==========
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { criarBotao(); iniciarInterface(); });
    else { criarBotao(); iniciarInterface(); }

})();
