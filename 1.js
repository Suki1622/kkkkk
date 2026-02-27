javascript:(function() {
    // Versão Bookmarklet do Coletor de Relíquias - Tribal Wars
    
    // Verificar se já está carregado
    if (window.relicScannerLoaded) {
        if (confirm('Scanner já carregado! Deseja reabrir o painel?')) {
            document.getElementById('relic-scanner-panel-principal')?.remove();
            iniciarInterface();
        }
        return;
    }
    
    window.relicScannerLoaded = true;
    
    // ========== CONFIGURAÇÕES ==========
    const CONFIG = {
        relatoriosPorVez: 3, // Reduzido para evitar sobrecarga
        delayEntreRequisicoes: 1000,
        timeoutCarregamento: 8000,
        autoStart: false,
        usarLocalStorage: true
    };
    
    // ========== ESTADO GLOBAL ==========
    let scannerAtivo = false;
    let relatoriosParaProcessar = [];
    let resultadosEncontrados = [];
    let relatoriosProcessados = 0;
    let relatoriosComErro = 0;
    let iframeContainer = null;
    let processandoLote = false;
    let processedReports = [];
    
    // Filtros de qualidade
    let filtroAtivo = {
        cinza: true,
        polished: true,
        refined: true
    };
    
    // ========== FUNÇÕES DE PERSISTÊNCIA (usando localStorage) ==========
    function salvarDados() {
        if (!CONFIG.usarLocalStorage) return;
        try {
            localStorage.setItem('relicScanner_results', JSON.stringify(resultadosEncontrados));
            localStorage.setItem('relicScanner_processed', JSON.stringify(processedReports));
        } catch (e) {
            console.error('Erro ao salvar:', e);
        }
    }
    
    function carregarDados() {
        if (!CONFIG.usarLocalStorage) return;
        try {
            const saved = localStorage.getItem('relicScanner_results');
            if (saved) resultadosEncontrados = JSON.parse(saved);
            
            const processed = localStorage.getItem('relicScanner_processed');
            if (processed) processedReports = JSON.parse(processed);
        } catch (e) {
            console.error('Erro ao carregar:', e);
        }
    }
    
    // ========== FUNÇÕES DE EXTRAÇÃO ==========
    function extractReportId(url) {
        const match = url.match(/&view=(\d+)/) || url.match(/report=(\d+)/);
        return match ? match[1] : null;
    }
    
    function extractDefenderCoordinates(iframeDoc) {
        try {
            const bodyText = iframeDoc.body.textContent;
            const patterns = [
                /Defensor:?\s*([^(]+)\((\d+)\|(\d+)\)/i,
                /Defender:?\s*([^(]+)\((\d+)\|(\d+)\)/i,
                /\((\d+)\|(\d+)\)/
            ];
            
            for (const pattern of patterns) {
                const match = bodyText.match(pattern);
                if (match) {
                    if (match.length === 4) {
                        return {
                            villageName: match[1].trim(),
                            coordinates: `${match[2]}|${match[3]}`
                        };
                    } else if (match.length === 3) {
                        return {
                            villageName: 'Desconhecida',
                            coordinates: `${match[1]}|${match[2]}`
                        };
                    }
                }
            }
        } catch (e) {}
        return null;
    }
    
    function determinarQualidadeReliquia(nomeReliquia) {
        const nome = nomeReliquia.toLowerCase();
        if (nome.includes('má qualidade') || nome.includes('ma qualidade') || nome.includes('shoddy')) {
            return 'cinza';
        } else if (nome.includes('básica') || nome.includes('basica') || nome.includes('polished')) {
            return 'polished';
        } else if (nome.includes('aprimorada') || nome.includes('refinada') || nome.includes('refined')) {
            return 'refined';
        }
        return 'cinza';
    }
    
    // ========== INTERFACE ==========
    function iniciarInterface() {
        // Carregar dados salvos
        carregarDados();
        
        // CSS Global
        const style = document.createElement('style');
        style.textContent = `
            #relic-scanner-panel-principal {
                position: fixed;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                width: 1000px;
                max-width: 95vw;
                height: 750px;
                max-height: 90vh;
                background: linear-gradient(145deg, #1a1a2e 0%, #16213e 100%);
                color: #fff;
                border-radius: 20px;
                box-shadow: 0 25px 50px rgba(0,0,0,0.7), 0 0 0 2px #4a4a6a inset;
                z-index: 10000;
                display: flex;
                flex-direction: column;
                overflow: hidden;
                font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                resize: both;
            }
            .relic-scanner-btn {
                transition: all 0.2s;
                cursor: pointer;
            }
            .relic-scanner-btn:hover {
                transform: translateY(-2px);
                filter: brightness(1.1);
            }
            @keyframes progressAnimation {
                0% { background-position: 0% 0; }
                100% { background-position: 200% 0; }
            }
        `;
        document.head.appendChild(style);
        
        criarPainel();
    }
    
    function criarPainel() {
        const painelAntigo = document.getElementById('relic-scanner-panel-principal');
        if (painelAntigo) painelAntigo.remove();
        
        const painel = document.createElement('div');
        painel.id = 'relic-scanner-panel-principal';
        
        // Cabeçalho
        painel.innerHTML = `
            <div style="padding: 18px 25px; background: linear-gradient(135deg, #2a2a40 0%, #1f1f30 100%); border-bottom: 3px solid #ffd700; display: flex; justify-content: space-between; align-items: center;">
                <div style="display: flex; align-items: center; gap: 15px;">
                    <h2 style="margin: 0; color: #ffd700; font-size: 22px;">⚔️ Coletor de Relíquias</h2>
                    <span id="scanner-status-indicator" style="font-size: 13px; padding: 5px 12px; background: #f44336; color: white; border-radius: 20px;">INATIVO</span>
                </div>
                <div style="display: flex; gap: 12px;">
                    <button id="btn-close-panel" style="background: rgba(255,255,255,0.1); border: none; color: white; font-size: 18px; cursor: pointer; width: 35px; height: 35px; border-radius: 8px;">✖</button>
                </div>
            </div>
            
            <div id="scanner-corpo-painel" style="flex: 1; overflow-y: auto; padding: 25px; background: rgba(26, 26, 46, 0.95);">
                <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 15px; margin-bottom: 25px;">
                    <div style="background: #2a2a40; padding: 15px; border-radius: 15px; text-align: center;">
                        <div style="font-size: 12px; color: #aaa;">Processados</div>
                        <div id="stats-processados" style="font-size: 28px; font-weight: bold; color: #4CAF50;">0</div>
                    </div>
                    <div style="background: #2a2a40; padding: 15px; border-radius: 15px; text-align: center;">
                        <div style="font-size: 12px; color: #aaa;">Relíquias</div>
                        <div id="stats-reliquias" style="font-size: 28px; font-weight: bold; color: #ffd700;">0</div>
                    </div>
                    <div style="background: #2a2a40; padding: 15px; border-radius: 15px; text-align: center;">
                        <div style="font-size: 12px; color: #aaa;">Erros</div>
                        <div id="stats-erros" style="font-size: 28px; font-weight: bold; color: #f44336;">0</div>
                    </div>
                    <div style="background: #2a2a40; padding: 15px; border-radius: 15px; text-align: center;">
                        <div style="font-size: 12px; color: #aaa;">Pendentes</div>
                        <div id="stats-pendentes" style="font-size: 28px; font-weight: bold; color: #FF9800;">0</div>
                    </div>
                </div>
                
                <!-- Filtros -->
                <div style="margin-bottom: 25px; background: #2a2a40; padding: 15px 20px; border-radius: 15px;">
                    <div style="display: flex; gap: 15px; flex-wrap: wrap;">
                        <button id="filtro-cinza" style="flex: 1; padding: 12px; background: #808080; color: white; border: 2px solid #fff; border-radius: 10px; cursor: pointer;">⚪ MÁ QUALIDADE</button>
                        <button id="filtro-polished" style="flex: 1; padding: 12px; background: #32CD32; color: white; border: 2px solid #fff; border-radius: 10px; cursor: pointer;">🟢 BÁSICA</button>
                        <button id="filtro-refined" style="flex: 1; padding: 12px; background: #4169E1; color: white; border: 2px solid #fff; border-radius: 10px; cursor: pointer;">🔵 APRIMORADA</button>
                        <button id="filtro-todos" style="flex: 1; padding: 12px; background: #4a4a6a; color: white; border: 2px solid #ffd700; border-radius: 10px; cursor: pointer;">✨ TODOS</button>
                    </div>
                </div>
                
                <!-- Progresso -->
                <div style="margin-bottom: 25px;">
                    <div style="background: #2a2a40; padding: 15px; border-radius: 15px;">
                        <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                            <span style="color: #ffd700;">Progresso</span>
                            <span id="progress-percent" style="color: #4CAF50;">0%</span>
                        </div>
                        <div style="width: 100%; height: 10px; background: #1a1a2e; border-radius: 5px;">
                            <div id="progress-bar" style="width: 0%; height: 100%; background: linear-gradient(90deg, #4CAF50, #8BC34A);"></div>
                        </div>
                    </div>
                </div>
                
                <!-- Lista de Relíquias -->
                <div style="margin-bottom: 15px;">
                    <h3 style="color: #ffd700; margin: 0 0 15px 0;">📋 Relíquias Encontradas <span id="contador-filtrado" style="background: #4a4a6a; padding: 3px 10px; border-radius: 15px; font-size: 14px;">0</span></h3>
                </div>
                <div id="lista-reliquias-container" style="min-height: 300px;"></div>
            </div>
            
            <!-- Rodapé -->
            <div style="padding: 18px 25px; background: linear-gradient(135deg, #2a2a40 0%, #1f1f30 100%); border-top: 3px solid #ffd700; display: flex; gap: 12px;">
                <button id="btn-iniciar-scanner" style="flex: 2; padding: 12px; background: #4CAF50; color: white; border: none; border-radius: 10px; cursor: pointer; font-weight: bold;">▶ INICIAR</button>
                <button id="btn-parar-scanner" style="flex: 1; padding: 12px; background: #f44336; color: white; border: none; border-radius: 10px; cursor: pointer; font-weight: bold;">⏹ PARAR</button>
                <button id="btn-copiar-resultados" style="flex: 1; padding: 12px; background: #FF9800; color: white; border: none; border-radius: 10px; cursor: pointer; font-weight: bold;">📋 COPIAR</button>
                <button id="btn-limpar-cache" style="flex: 1; padding: 12px; background: #666; color: white; border: none; border-radius: 10px; cursor: pointer; font-weight: bold;">🗑️ LIMPAR</button>
            </div>
        `;
        
        document.body.appendChild(painel);
        
        // Event listeners
        document.getElementById('btn-close-panel').onclick = () => painel.remove();
        document.getElementById('btn-iniciar-scanner').onclick = iniciarScanner;
        document.getElementById('btn-parar-scanner').onclick = pararScanner;
        document.getElementById('btn-copiar-resultados').onclick = copiarResultados;
        document.getElementById('btn-limpar-cache').onclick = limparCache;
        
        document.getElementById('filtro-cinza').onclick = () => {
            filtroAtivo.cinza = !filtroAtivo.cinza;
            atualizarBotoesFiltro();
            atualizarListaReliquias();
        };
        
        document.getElementById('filtro-polished').onclick = () => {
            filtroAtivo.polished = !filtroAtivo.polished;
            atualizarBotoesFiltro();
            atualizarListaReliquias();
        };
        
        document.getElementById('filtro-refined').onclick = () => {
            filtroAtivo.refined = !filtroAtivo.refined;
            atualizarBotoesFiltro();
            atualizarListaReliquias();
        };
        
        document.getElementById('filtro-todos').onclick = () => {
            filtroAtivo.cinza = true;
            filtroAtivo.polished = true;
            filtroAtivo.refined = true;
            atualizarBotoesFiltro();
            atualizarListaReliquias();
        };
        
        atualizarBotoesFiltro();
        atualizarPainel();
    }
    
    function atualizarBotoesFiltro() {
        const btnCinza = document.getElementById('filtro-cinza');
        const btnPolished = document.getElementById('filtro-polished');
        const btnRefined = document.getElementById('filtro-refined');
        
        if (btnCinza) {
            btnCinza.style.background = filtroAtivo.cinza ? '#808080' : '#333';
            btnCinza.style.border = filtroAtivo.cinza ? '2px solid #fff' : '1px solid #555';
        }
        if (btnPolished) {
            btnPolished.style.background = filtroAtivo.polished ? '#32CD32' : '#1e4a1e';
            btnPolished.style.border = filtroAtivo.polished ? '2px solid #fff' : '1px solid #2e6b2e';
        }
        if (btnRefined) {
            btnRefined.style.background = filtroAtivo.refined ? '#4169E1' : '#1e3a6b';
            btnRefined.style.border = filtroAtivo.refined ? '2px solid #fff' : '1px solid #2e4f8a';
        }
    }
    
    function getReliquiasFiltradas() {
        return resultadosEncontrados.filter(rel => {
            const qualidade = determinarQualidadeReliquia(rel.relic);
            return filtroAtivo[qualidade];
        });
    }
    
    function atualizarListaReliquias() {
        const container = document.getElementById('lista-reliquias-container');
        const contadorFiltrado = document.getElementById('contador-filtrado');
        if (!container) return;
        
        const reliquiasFiltradas = getReliquiasFiltradas();
        if (contadorFiltrado) contadorFiltrado.textContent = reliquiasFiltradas.length;
        
        if (reliquiasFiltradas.length === 0) {
            container.innerHTML = '<div style="text-align: center; padding: 50px; color: #666;">Nenhuma relíquia encontrada</div>';
        } else {
            let html = '';
            reliquiasFiltradas.slice().reverse().forEach((rel, i) => {
                const qualidade = determinarQualidadeReliquia(rel.relic);
                const cor = qualidade === 'cinza' ? '#808080' : (qualidade === 'polished' ? '#32CD32' : '#4169E1');
                const coords = rel.defenderCoordinates || rel.coordinates || 'N/A';
                const vila = rel.defenderVillage || rel.village || 'Desconhecida';
                
                html += `
                    <div style="margin-bottom: 10px; padding: 15px; background: #2a2a40; border-radius: 10px; border-left: 4px solid ${cor};">
                        <div style="font-weight: bold; color: ${cor};">${rel.relic}</div>
                        <div style="font-size: 13px; color: #aaa; margin-top: 5px;">
                            📍 ${coords} | 🏘️ ${vila} | 📋 ${rel.reportId}
                        </div>
                    </div>
                `;
            });
            container.innerHTML = html;
        }
    }
    
    function atualizarPainel() {
        const elementos = {
            processados: document.getElementById('stats-processados'),
            reliquias: document.getElementById('stats-reliquias'),
            erros: document.getElementById('stats-erros'),
            pendentes: document.getElementById('stats-pendentes'),
            progressBar: document.getElementById('progress-bar'),
            progressPercent: document.getElementById('progress-percent'),
            statusIndicator: document.getElementById('scanner-status-indicator')
        };
        
        if (!elementos.processados) return;
        
        elementos.processados.textContent = relatoriosProcessados;
        elementos.reliquias.textContent = resultadosEncontrados.length;
        elementos.erros.textContent = relatoriosComErro;
        elementos.pendentes.textContent = Math.max(0, relatoriosParaProcessar.length - relatoriosProcessados);
        
        const total = relatoriosParaProcessar.length || 1;
        const percentual = Math.min(100, Math.round((relatoriosProcessados / total) * 100));
        if (elementos.progressBar) elementos.progressBar.style.width = percentual + '%';
        if (elementos.progressPercent) elementos.progressPercent.textContent = percentual + '%';
        
        if (elementos.statusIndicator) {
            elementos.statusIndicator.textContent = scannerAtivo ? 'ATIVO' : 'INATIVO';
            elementos.statusIndicator.style.background = scannerAtivo ? '#4CAF50' : '#f44336';
        }
        
        atualizarListaReliquias();
    }
    
    // ========== FUNÇÕES DE COLETA ==========
    function criarIframeContainer() {
        if (iframeContainer) return;
        iframeContainer = document.createElement('div');
        iframeContainer.id = 'relic-scanner-iframes';
        iframeContainer.style.cssText = 'display: none; position: absolute; top: -9999px;';
        document.body.appendChild(iframeContainer);
    }
    
    function analisarReliquiasNoIframe(iframeDoc, reportInfo) {
        const relics = [];
        const defenderInfo = extractDefenderCoordinates(iframeDoc);
        
        const relicElements = iframeDoc.querySelectorAll(
            '.relic-quality-shoddy.inline-relic, ' +
            '.relic-quality-polished.inline-relic, ' +
            '.relic-quality-refined.inline-relic'
        );
        
        relicElements.forEach(element => {
            const relicName = element.textContent.trim();
            const imgElement = element.querySelector('img.relic-icon-small');
            let imagemUrl = imgElement ? imgElement.src : '';
            
            if (!imagemUrl) {
                const nomeFormatado = relicName.toLowerCase().replace(/[^a-z0-9]/g, '_');
                let qualidade = 'shoddy';
                if (element.classList.contains('relic-quality-polished')) qualidade = 'polished';
                else if (element.classList.contains('relic-quality-refined')) qualidade = 'refined';
                imagemUrl = `https://dsbr.innogamescdn.com/asset/c9b60b77/graphic/relic_system/relics_46/${nomeFormatado}_${qualidade}.webp`;
            }
            
            relics.push({
                relic: relicName,
                imagemUrl: imagemUrl,
                defenderCoordinates: defenderInfo ? defenderInfo.coordinates : null,
                defenderVillage: defenderInfo ? defenderInfo.villageName : null,
                coordinates: reportInfo.coordinates || null,
                village: reportInfo.villageName || null,
                reportId: reportInfo.id,
                timestamp: Date.now()
            });
        });
        
        return relics;
    }
    
    function carregarRelatorioViaIframe(relatorio) {
        return new Promise((resolve) => {
            const iframe = document.createElement('iframe');
            iframe.src = relatorio.url;
            iframe.style.display = 'none';
            
            const timeoutId = setTimeout(() => {
                relatoriosComErro++;
                if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
                atualizarPainel();
                resolve({ relatorio, relics: [], erro: 'timeout' });
            }, CONFIG.timeoutCarregamento);
            
            iframe.onload = () => {
                clearTimeout(timeoutId);
                
                try {
                    const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
                    const relics = analisarReliquiasNoIframe(iframeDoc, relatorio);
                    
                    if (relics.length > 0) {
                        resultadosEncontrados.push(...relics);
                        salvarDados();
                        atualizarPainel();
                    }
                    
                    setTimeout(() => {
                        if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
                    }, 50);
                    
                    resolve({ relatorio, relics, erro: null });
                    
                } catch (e) {
                    relatoriosComErro++;
                    if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
                    resolve({ relatorio, relics: [], erro: e.message });
                }
            };
            
            iframe.onerror = () => {
                clearTimeout(timeoutId);
                relatoriosComErro++;
                if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
                resolve({ relatorio, relics: [], erro: 'load_error' });
            };
            
            iframeContainer.appendChild(iframe);
        });
    }
    
    function coletarRelatorios() {
        const relatorios = [];
        const links = document.querySelectorAll('a[href*="screen=report"][href*="view="]');
        
        links.forEach(link => {
            const href = link.href;
            const reportId = extractReportId(href);
            
            if (!reportId || processedReports.includes(reportId)) return;
            
            const text = link.textContent;
            relatorios.push({
                id: reportId,
                url: href,
                text: text,
                processado: false
            });
        });
        
        return relatorios;
    }
    
    // ========== FUNÇÕES DE CONTROLE ==========
    async function iniciarScanner() {
        if (scannerAtivo || processandoLote) {
            alert('Scanner já está em execução!');
            return;
        }
        
        scannerAtivo = true;
        processandoLote = false;
        relatoriosProcessados = 0;
        relatoriosComErro = 0;
        
        criarIframeContainer();
        relatoriosParaProcessar = coletarRelatorios();
        
        if (relatoriosParaProcessar.length === 0) {
            alert('Nenhum relatório novo encontrado!');
            scannerAtivo = false;
            atualizarPainel();
            return;
        }
        
        atualizarPainel();
        
        for (let i = 0; i < relatoriosParaProcessar.length; i += CONFIG.relatoriosPorVez) {
            if (!scannerAtivo) break;
            
            processandoLote = true;
            const lote = relatoriosParaProcessar.slice(i, i + CONFIG.relatoriosPorVez);
            
            const promises = lote.map(rel => carregarRelatorioViaIframe(rel));
            await Promise.all(promises);
            
            relatoriosProcessados += lote.length;
            processedReports.push(...lote.map(r => r.id));
            salvarDados();
            atualizarPainel();
            processandoLote = false;
            
            if (i + CONFIG.relatoriosPorVez < relatoriosParaProcessar.length && scannerAtivo) {
                await new Promise(r => setTimeout(r, CONFIG.delayEntreRequisicoes));
            }
        }
        
        scannerAtivo = false;
        atualizarPainel();
        
        if (resultadosEncontrados.length > 0) {
            alert(`✅ Scanner concluído! ${getReliquiasFiltradas().length} relíquias encontradas.`);
        }
    }
    
    function pararScanner() {
        scannerAtivo = false;
        processandoLote = false;
        
        if (iframeContainer) {
            while (iframeContainer.firstChild) {
                iframeContainer.removeChild(iframeContainer.firstChild);
            }
        }
        
        atualizarPainel();
    }
    
    function copiarResultados() {
        const reliquiasFiltradas = getReliquiasFiltradas();
        
        if (reliquiasFiltradas.length === 0) {
            alert('Nenhum resultado para copiar');
            return;
        }
        
        let texto = 'RELÍQUIAS ENCONTRADAS - TRIBAL WARS\n';
        texto += '='.repeat(50) + '\n\n';
        
        reliquiasFiltradas.forEach((r, i) => {
            const qualidade = determinarQualidadeReliquia(r.relic);
            const emoji = qualidade === 'cinza' ? '⚪' : (qualidade === 'polished' ? '🟢' : '🔵');
            const coords = r.defenderCoordinates || r.coordinates || 'N/A';
            
            texto += `${emoji} ${i+1}. ${r.relic}\n`;
            texto += `   📍 ${coords}\n`;
            texto += `   📋 ID: ${r.reportId}\n\n`;
        });
        
        navigator.clipboard.writeText(texto).then(() => {
            alert('✅ Resultados copiados!');
        }).catch(() => {
            prompt('Copie o texto abaixo:', texto);
        });
    }
    
    function limparCache() {
        if (confirm('⚠️ Limpar todo o histórico?')) {
            localStorage.removeItem('relicScanner_results');
            localStorage.removeItem('relicScanner_processed');
            resultadosEncontrados = [];
            processedReports = [];
            relatoriosProcessados = 0;
            relatoriosComErro = 0;
            atualizarPainel();
            alert('✅ Cache limpo!');
        }
    }
    
    // Iniciar
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', iniciarInterface);
    } else {
        iniciarInterface();
    }
})();