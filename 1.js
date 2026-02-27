// Coletor de Relíquias - Tribal Wars
// Versão: 2.0 - Ícones corrigidos
(function() {
    'use strict';
    
    // Impedir múltiplas execuções
    if (window.relicCollectorRunning) {
        if (confirm('Coletor já está rodando! Deseja abrir o painel?')) {
            document.getElementById('relic-scanner-panel-principal')?.remove();
            iniciarInterface();
        }
        return;
    }
    window.relicCollectorRunning = true;
    
    // ========== CONFIGURAÇÕES ==========
    const CONFIG = {
        relatoriosPorVez: 3,
        delayEntreRequisicoes: 1000,
        timeoutCarregamento: 8000,
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
    
    // Mapeamento de nomes de relíquias para URLs de ícones
    const ICONES_RELIQUIAS = {
        // Má Qualidade (Shoddy)
        'espada': 'relic_sword_shoddy',
        'espada longa': 'relic_long_sword_shoddy',
        'escudo': 'relic_shield_shoddy',
        'armadura': 'relic_armor_shoddy',
        'capacete': 'relic_helmet_shoddy',
        'machado': 'relic_axe_shoddy',
        'lança': 'relic_spear_shoddy',
        'arco': 'relic_bow_shoddy',
        'cajado': 'relic_staff_shoddy',
        'livro': 'relic_book_shoddy',
        'coroa': 'relic_crown_shoddy',
        'cetro': 'relic_sceptre_shoddy',
        'amuleto': 'relic_amulet_shoddy',
        'anel': 'relic_ring_shoddy',
        'cálice': 'relic_chalice_shoddy',
        'joia': 'relic_jewel_shoddy',
        
        // Básica (Polished)
        'espada básica': 'relic_sword_polished',
        'espada longa básica': 'relic_long_sword_polished',
        'escudo básico': 'relic_shield_polished',
        'armadura básica': 'relic_armor_polished',
        'capacete básico': 'relic_helmet_polished',
        'machado básico': 'relic_axe_polished',
        'lança básica': 'relic_spear_polished',
        'arco básico': 'relic_bow_polished',
        'cajado básico': 'relic_staff_polished',
        'livro básico': 'relic_book_polished',
        'coroa básica': 'relic_crown_polished',
        'cetro básico': 'relic_sceptre_polished',
        'amuleto básico': 'relic_amulet_polished',
        'anel básico': 'relic_ring_polished',
        'cálice básico': 'relic_chalice_polished',
        'joia básica': 'relic_jewel_polished',
        
        // Aprimorada (Refined)
        'espada aprimorada': 'relic_sword_refined',
        'espada longa aprimorada': 'relic_long_sword_refined',
        'escudo aprimorado': 'relic_shield_refined',
        'armadura aprimorada': 'relic_armor_refined',
        'capacete aprimorado': 'relic_helmet_refined',
        'machado aprimorado': 'relic_axe_refined',
        'lança aprimorada': 'relic_spear_refined',
        'arco aprimorado': 'relic_bow_refined',
        'cajado aprimorado': 'relic_staff_refined',
        'livro aprimorado': 'relic_book_refined',
        'coroa aprimorada': 'relic_crown_refined',
        'cetro aprimorado': 'relic_sceptre_refined',
        'amuleto aprimorado': 'relic_amulet_refined',
        'anel aprimorado': 'relic_ring_refined',
        'cálice aprimorado': 'relic_chalice_refined',
        'joia aprimorada': 'relic_jewel_refined'
    };
    
    // ========== FUNÇÕES DE PERSISTÊNCIA ==========
    function salvarDados() {
        try {
            localStorage.setItem('relic_results', JSON.stringify(resultadosEncontrados));
            localStorage.setItem('relic_processed', JSON.stringify(processedReports));
        } catch (e) {}
    }
    
    function carregarDados() {
        try {
            const saved = localStorage.getItem('relic_results');
            if (saved) resultadosEncontrados = JSON.parse(saved);
            const processed = localStorage.getItem('relic_processed');
            if (processed) processedReports = JSON.parse(processed);
        } catch (e) {}
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
                /Atacante:?\s*([^(]+)\((\d+)\|(\d+)\)/i,
                /Attacker:?\s*([^(]+)\((\d+)\|(\d+)\)/i,
                /Aldeia:?\s*([^(]+)\((\d+)\|(\d+)\)/i,
                /Village:?\s*([^(]+)\((\d+)\|(\d+)\)/i,
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
                        // Tentar extrair nome da vila do contexto
                        const coordIndex = match.index;
                        const textBefore = bodyText.substring(Math.max(0, coordIndex - 100), coordIndex);
                        const nameMatch = textBefore.match(/([A-Za-zÀ-ÖØ-öø-ÿ\s]{3,50}?)$/);
                        return {
                            villageName: nameMatch ? nameMatch[1].trim() : 'Desconhecida',
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
        
        // Fallback por palavras-chave
        if (nome.includes('perfei') || nome.includes('perfeita')) return 'refined';
        if (nome.includes('bas')) return 'polished';
        return 'cinza';
    }
    
    function extrairNomeBaseReliquia(nomeCompleto) {
        let nome = nomeCompleto.toLowerCase();
        // Remover indicadores de qualidade
        nome = nome.replace('má qualidade', '').replace('ma qualidade', '')
                   .replace('básica', '').replace('basica', '')
                   .replace('aprimorada', '').replace('refinada', '')
                   .replace('shoddy', '').replace('polished', '').replace('refined', '')
                   .replace('✨', '').trim();
        
        // Mapear variações comuns
        if (nome.includes('espada longa')) return 'espada longa';
        if (nome.includes('espada')) return 'espada';
        if (nome.includes('escudo')) return 'escudo';
        if (nome.includes('armadura')) return 'armadura';
        if (nome.includes('capacete')) return 'capacete';
        if (nome.includes('machado')) return 'machado';
        if (nome.includes('lança')) return 'lança';
        if (nome.includes('arco')) return 'arco';
        if (nome.includes('cajado')) return 'cajado';
        if (nome.includes('livro')) return 'livro';
        if (nome.includes('coroa')) return 'coroa';
        if (nome.includes('cetro')) return 'cetro';
        if (nome.includes('amuleto')) return 'amuleto';
        if (nome.includes('anel')) return 'anel';
        if (nome.includes('cálice')) return 'cálice';
        if (nome.includes('joia')) return 'joia';
        
        return nome.split(' ')[0]; // Retorna primeira palavra como fallback
    }
    
    function getIconeReliquia(nomeReliquia, qualidade) {
        const nomeBase = extrairNomeBaseReliquia(nomeReliquia);
        
        // Tentar encontrar no mapeamento
        for (let [chave, valor] of Object.entries(ICONES_RELIQUIAS)) {
            if (nomeBase.includes(chave) || chave.includes(nomeBase)) {
                // Ajustar qualidade no nome do ícone
                if (qualidade === 'cinza' && valor.includes('_polished')) {
                    valor = valor.replace('_polished', '_shoddy');
                } else if (qualidade === 'cinza' && valor.includes('_refined')) {
                    valor = valor.replace('_refined', '_shoddy');
                } else if (qualidade === 'polished' && valor.includes('_shoddy')) {
                    valor = valor.replace('_shoddy', '_polished');
                } else if (qualidade === 'polished' && valor.includes('_refined')) {
                    valor = valor.replace('_refined', '_polished');
                } else if (qualidade === 'refined' && valor.includes('_shoddy')) {
                    valor = valor.replace('_shoddy', '_refined');
                } else if (qualidade === 'refined' && valor.includes('_polished')) {
                    valor = valor.replace('_polished', '_refined');
                }
                
                return `https://dsbr.innogamescdn.com/asset/c9b60b77/graphic/relic_system/relics_46/${valor}.webp`;
            }
        }
        
        // Fallback genérico baseado na qualidade
        const sufixo = qualidade === 'cinza' ? 'shoddy' : (qualidade === 'polished' ? 'polished' : 'refined');
        return `https://dsbr.innogamescdn.com/asset/c9b60b77/graphic/relic_system/relics_46/relic_${sufixo}.webp`;
    }
    
    // ========== INTERFACE ==========
    function iniciarInterface() {
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
            .relic-card {
                transition: all 0.2s;
                cursor: pointer;
            }
            .relic-card:hover {
                transform: translateX(5px);
                box-shadow: 0 5px 20px rgba(0,0,0,0.5);
            }
            .relic-image {
                transition: all 0.3s;
            }
            .relic-image:hover {
                transform: scale(1.1);
            }
            @keyframes slideIn {
                from { opacity: 0; transform: translateX(-20px); }
                to { opacity: 1; transform: translateX(0); }
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
        
        painel.innerHTML = `
            <div style="padding: 18px 25px; background: linear-gradient(135deg, #2a2a40 0%, #1f1f30 100%); border-bottom: 3px solid #ffd700; display: flex; justify-content: space-between; align-items: center;">
                <div style="display: flex; align-items: center; gap: 15px;">
                    <h2 style="margin: 0; color: #ffd700; font-size: 24px; display: flex; align-items: center; gap: 10px;">
                        <span>⚔️</span> Coletor de Relíquias
                    </h2>
                    <span id="scanner-status-indicator" style="font-size: 13px; padding: 5px 15px; background: #f44336; color: white; border-radius: 20px; font-weight: bold;">INATIVO</span>
                </div>
                <button id="btn-close-panel" style="background: rgba(255,255,255,0.1); border: none; color: white; font-size: 20px; cursor: pointer; width: 35px; height: 35px; border-radius: 8px; display: flex; align-items: center; justify-content: center;" title="Fechar">✖</button>
            </div>
            
            <div style="flex: 1; overflow-y: auto; padding: 25px; background: rgba(26, 26, 46, 0.95);">
                <!-- Estatísticas -->
                <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 15px; margin-bottom: 25px;">
                    <div style="background: #2a2a40; padding: 15px; border-radius: 15px; text-align: center; border: 1px solid #4a4a6a;">
                        <div style="font-size: 12px; color: #aaa; text-transform: uppercase;">Processados</div>
                        <div id="stats-processados" style="font-size: 28px; font-weight: bold; color: #4CAF50;">0</div>
                    </div>
                    <div style="background: #2a2a40; padding: 15px; border-radius: 15px; text-align: center; border: 1px solid #4a4a6a;">
                        <div style="font-size: 12px; color: #aaa; text-transform: uppercase;">Relíquias</div>
                        <div id="stats-reliquias" style="font-size: 28px; font-weight: bold; color: #ffd700;">0</div>
                    </div>
                    <div style="background: #2a2a40; padding: 15px; border-radius: 15px; text-align: center; border: 1px solid #4a4a6a;">
                        <div style="font-size: 12px; color: #aaa; text-transform: uppercase;">Erros</div>
                        <div id="stats-erros" style="font-size: 28px; font-weight: bold; color: #f44336;">0</div>
                    </div>
                    <div style="background: #2a2a40; padding: 15px; border-radius: 15px; text-align: center; border: 1px solid #4a4a6a;">
                        <div style="font-size: 12px; color: #aaa; text-transform: uppercase;">Pendentes</div>
                        <div id="stats-pendentes" style="font-size: 28px; font-weight: bold; color: #FF9800;">0</div>
                    </div>
                </div>
                
                <!-- Filtros -->
                <div style="margin-bottom: 25px; background: #2a2a40; padding: 20px; border-radius: 15px; border: 1px solid #4a4a6a;">
                    <div style="display: flex; gap: 10px; flex-wrap: wrap;">
                        <button id="filtro-cinza" style="flex: 1; min-width: 120px; padding: 12px; background: #808080; color: white; border: 2px solid #fff; border-radius: 10px; cursor: pointer; font-weight: bold; display: flex; align-items: center; justify-content: center; gap: 8px;">
                            <span>⚪</span> MÁ QUALIDADE
                        </button>
                        <button id="filtro-polished" style="flex: 1; min-width: 120px; padding: 12px; background: #32CD32; color: white; border: 2px solid #fff; border-radius: 10px; cursor: pointer; font-weight: bold; display: flex; align-items: center; justify-content: center; gap: 8px;">
                            <span>🟢</span> BÁSICA
                        </button>
                        <button id="filtro-refined" style="flex: 1; min-width: 120px; padding: 12px; background: #4169E1; color: white; border: 2px solid #fff; border-radius: 10px; cursor: pointer; font-weight: bold; display: flex; align-items: center; justify-content: center; gap: 8px;">
                            <span>🔵</span> APRIMORADA
                        </button>
                        <button id="filtro-todos" style="flex: 1; min-width: 120px; padding: 12px; background: #4a4a6a; color: white; border: 2px solid #ffd700; border-radius: 10px; cursor: pointer; font-weight: bold; display: flex; align-items: center; justify-content: center; gap: 8px;">
                            <span>✨</span> TODOS
                        </button>
                    </div>
                </div>
                
                <!-- Progresso -->
                <div style="margin-bottom: 25px; background: #2a2a40; padding: 15px 20px; border-radius: 15px; border: 1px solid #4a4a6a;">
                    <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                        <span style="color: #ffd700; font-weight: bold;">📊 Progresso do Scanner</span>
                        <span id="progress-percent" style="color: #4CAF50; font-weight: bold;">0%</span>
                    </div>
                    <div style="width: 100%; height: 10px; background: #1a1a2e; border-radius: 5px; overflow: hidden;">
                        <div id="progress-bar" style="width: 0%; height: 100%; background: linear-gradient(90deg, #4CAF50, #8BC34A); transition: width 0.3s;"></div>
                    </div>
                </div>
                
                <!-- Título da Lista -->
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
                    <h3 style="color: #ffd700; margin: 0; font-size: 18px; display: flex; align-items: center; gap: 8px;">
                        <span>📋 Relíquias Encontradas</span>
                        <span id="contador-filtrado" style="background: #4a4a6a; padding: 3px 12px; border-radius: 20px; font-size: 14px;">0</span>
                    </h3>
                    <span id="ultima-atualizacao" style="font-size: 12px; color: #888;">Aguardando...</span>
                </div>
                
                <!-- Lista de Relíquias -->
                <div id="lista-reliquias-container" style="min-height: 300px; max-height: 400px; overflow-y: auto; padding-right: 5px;"></div>
            </div>
            
            <!-- Rodapé com botões -->
            <div style="padding: 18px 25px; background: linear-gradient(135deg, #2a2a40 0%, #1f1f30 100%); border-top: 3px solid #ffd700; display: flex; gap: 12px;">
                <button id="btn-iniciar-scanner" style="flex: 2; padding: 12px 20px; background: #4CAF50; color: white; border: none; border-radius: 10px; cursor: pointer; font-weight: bold; font-size: 15px; display: flex; align-items: center; justify-content: center; gap: 8px;">
                    <span>▶</span> INICIAR SCANNER
                </button>
                <button id="btn-parar-scanner" style="flex: 1; padding: 12px; background: #f44336; color: white; border: none; border-radius: 10px; cursor: pointer; font-weight: bold; display: flex; align-items: center; justify-content: center; gap: 8px;">
                    <span>⏹</span> PARAR
                </button>
                <button id="btn-copiar-resultados" style="flex: 1; padding: 12px; background: #FF9800; color: white; border: none; border-radius: 10px; cursor: pointer; font-weight: bold; display: flex; align-items: center; justify-content: center; gap: 8px;">
                    <span>📋</span> COPIAR
                </button>
                <button id="btn-limpar-cache" style="flex: 1; padding: 12px; background: #666; color: white; border: none; border-radius: 10px; cursor: pointer; font-weight: bold; display: flex; align-items: center; justify-content: center; gap: 8px;">
                    <span>🗑️</span> LIMPAR
                </button>
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
        const contador = document.getElementById('contador-filtrado');
        const ultimaAtualizacao = document.getElementById('ultima-atualizacao');
        
        if (!container) return;
        
        const reliquias = getReliquiasFiltradas();
        if (contador) contador.textContent = reliquias.length;
        if (ultimaAtualizacao) ultimaAtualizacao.textContent = `Última: ${new Date().toLocaleTimeString()}`;
        
        if (reliquias.length === 0) {
            container.innerHTML = `
                <div style="text-align: center; padding: 80px 20px; background: #2a2a40; border-radius: 15px; border: 2px dashed #4a4a6a;">
                    <div style="font-size: 60px; margin-bottom: 20px; opacity: 0.5;">🔍</div>
                    <div style="font-size: 18px; color: #aaa;">Nenhuma relíquia encontrada</div>
                    <div style="font-size: 14px; color: #666; margin-top: 10px;">
                        ${Object.values(filtroAtivo).every(v => !v) ? 
                          'Ative pelo menos um filtro para ver as relíquias' : 
                          'Inicie o scanner para começar a coleta'}
                    </div>
                </div>
            `;
        } else {
            let html = '';
            reliquias.slice().reverse().forEach((rel, index) => {
                const qualidade = determinarQualidadeReliquia(rel.relic);
                const cor = qualidade === 'cinza' ? '#808080' : (qualidade === 'polished' ? '#32CD32' : '#4169E1');
                const coords = rel.defenderCoordinates || rel.coordinates || 'N/A';
                const vila = rel.defenderVillage || rel.village || 'Desconhecida';
                const iconeQualidade = qualidade === 'cinza' ? '⚪' : (qualidade === 'polished' ? '🟢' : '🔵');
                const imagemUrl = rel.imagemUrl || getIconeReliquia(rel.relic, qualidade);
                
                html += `
                    <div class="relic-card" style="margin-bottom: 15px; padding: 15px; background: linear-gradient(145deg, #2a2a40, #1f1f30); border-radius: 12px; border-left: 6px solid ${cor}; display: flex; gap: 15px; align-items: center; animation: slideIn 0.3s;">
                        <div style="flex-shrink: 0; position: relative;">
                            <img src="${imagemUrl}" class="relic-image" style="width: 50px; height: 50px; border-radius: 8px; background: #1a1a2e; padding: 5px; border: 2px solid ${cor};" 
                                 onerror="this.src='https://via.placeholder.com/50?text='; this.onerror=null;">
                            <span style="position: absolute; top: -5px; right: -5px; background: ${cor}; width: 20px; height: 20px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 12px; border: 2px solid #1a1a2e;">${iconeQualidade}</span>
                        </div>
                        <div style="flex: 1;">
                            <div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
                                <span style="font-weight: bold; color: ${cor};">${rel.relic}</span>
                                <span style="font-size: 11px; color: #888;">${new Date(rel.timestamp).toLocaleTimeString()}</span>
                            </div>
                            <div style="display: grid; grid-template-columns: auto 1fr; gap: 5px; font-size: 13px;">
                                <span style="color: #ffd700;">📍</span>
                                <span style="color: #4CAF50; font-weight: bold;">${coords}</span>
                                <span style="color: #ffd700;">🏘️</span>
                                <span style="color: #fff;">${vila}</span>
                                <span style="color: #ffd700;">📋</span>
                                <span style="color: #aaa;">ID: ${rel.reportId}</span>
                            </div>
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
        
        // Seletores para diferentes qualidades
        const relicElements = iframeDoc.querySelectorAll(
            '.relic-quality-shoddy.inline-relic, ' +
            '.relic-quality-polished.inline-relic, ' +
            '.relic-quality-refined.inline-relic, ' +
            '.relic-quality-shoddy, ' +
            '.relic-quality-polished, ' +
            '.relic-quality-refined'
        );
        
        console.log(`[Scanner] Encontrados ${relicElements.length} elementos de relíquia`);
        
        relicElements.forEach(element => {
            const relicName = element.textContent.trim();
            console.log(`[Scanner] Relíquia: "${relicName}"`);
            
            // Determinar qualidade
            let qualidade = 'cinza';
            if (element.classList.contains('relic-quality-polished')) {
                qualidade = 'polished';
            } else if (element.classList.contains('relic-quality-refined')) {
                qualidade = 'refined';
            }
            
            // Tentar extrair imagem
            const imgElement = element.querySelector('img.relic-icon-small');
            let imagemUrl = imgElement ? imgElement.src : getIconeReliquia(relicName, qualidade);
            
            relics.push({
                relic: relicName,
                imagemUrl: imagemUrl,
                defenderCoordinates: defenderInfo ? defenderInfo.coordinates : null,
                defenderVillage: defenderInfo ? defenderInfo.villageName : null,
                coordinates: reportInfo.coordinates || null,
                village: reportInfo.villageName || null,
                reportId: reportInfo.id,
                timestamp: Date.now(),
                qualidade: qualidade
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
                resolve({ relatorio, relics: [] });
            }, CONFIG.timeoutCarregamento);
            
            iframe.onload = () => {
                clearTimeout(timeoutId);
                
                try {
                    const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
                    const relics = analisarReliquiasNoIframe(iframeDoc, relatorio);
                    
                    if (relics.length > 0) {
                        console.log(`[Scanner] ${relics.length} relíquias encontradas no relatório ${relatorio.id}`);
                        resultadosEncontrados.push(...relics);
                        salvarDados();
                        atualizarPainel();
                    }
                    
                    setTimeout(() => {
                        if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
                    }, 50);
                    
                    resolve({ relatorio, relics });
                    
                } catch (e) {
                    console.error(`[Scanner] Erro:`, e);
                    relatoriosComErro++;
                    if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
                    resolve({ relatorio, relics: [] });
                }
            };
            
            iframe.onerror = () => {
                clearTimeout(timeoutId);
                relatoriosComErro++;
                if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
                resolve({ relatorio, relics: [] });
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
            
            relatorios.push({
                id: reportId,
                url: href,
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
        
        console.log(`[Scanner] Iniciando coleta de ${relatoriosParaProcessar.length} relatórios`);
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
        
        console.log('[Scanner] Parado pelo usuário');
        atualizarPainel();
    }
    
    function copiarResultados() {
        const reliquias = getReliquiasFiltradas();
        
        if (reliquias.length === 0) {
            alert('Nenhum resultado para copiar');
            return;
        }
        
        let texto = '📋 RELÍQUIAS ENCONTRADAS - TRIBAL WARS\n';
        texto += '='.repeat(50) + '\n';
        texto += `📅 Data: ${new Date().toLocaleString()}\n`;
        texto += `📊 Total: ${reliquias.length} relíquias\n`;
        texto += '='.repeat(50) + '\n\n';
        
        reliquias.forEach((r, i) => {
            const qualidade = determinarQualidadeReliquia(r.relic);
            const emoji = qualidade === 'cinza' ? '⚪' : (qualidade === 'polished' ? '🟢' : '🔵');
            const coords = r.defenderCoordinates || r.coordinates || 'N/A';
            const vila = r.defenderVillage || r.village || 'Desconhecida';
            
            texto += `${emoji} ${i+1}. ${r.relic}\n`;
            texto += `   📍 Coordenadas: ${coords}\n`;
            texto += `   🏘️ Vila: ${vila}\n`;
            texto += `   📋 ID: ${r.reportId}\n\n`;
        });
        
        navigator.clipboard.writeText(texto).then(() => {
            alert('✅ Resultados copiados para a área de transferência!');
        }).catch(() => {
            prompt('Copie o texto abaixo:', texto);
        });
    }
    
    function limparCache() {
        if (confirm('⚠️ Isso vai limpar todo o histórico de relatórios processados. Continuar?')) {
            localStorage.removeItem('relic_results');
            localStorage.removeItem('relic_processed');
            resultadosEncontrados = [];
            processedReports = [];
            relatoriosProcessados = 0;
            relatoriosComErro = 0;
            atualizarPainel();
            alert('✅ Cache limpo com sucesso!');
        }
    }
    
    // Iniciar
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', iniciarInterface);
    } else {
        iniciarInterface();
    }
})();
