/**
 * CÉREBRO SEMÂNTICO IDEnza – Motor & Interface
 * Auto‑injeção: cria uma nova aba "Cérebro Semântico" sem modificar o HTML original.
 * Dependências: o HTML original já contém REDIS_CONFIG, COGNITIVE_SYSTEM, etc.
 */

(function() {
  'use strict';

  // ======================== MOTOR SEMÂNTICO (Backend Local) ========================
  const BrainEngine = (() => {
    const STORE_KEY = 'idenza_brain_store_v2';
    let store;

    // Inicializa / carrega do localStorage
    function loadStore() {
      try {
        const raw = localStorage.getItem(STORE_KEY);
        store = raw ? JSON.parse(raw) : null;
      } catch(e) { store = null; }
      if (!store || typeof store !== 'object') {
        store = {
          conceitos: {},       // id -> { id, nome, definicao, ... , embedding }
          documentos: {},      // id -> { id, titulo, conteudo, ... , embedding }
          relacoes: {},        // id -> [ { destino, tipo } ]
          historico: [],       // Array de interações
          cache: {},           // hash -> { resposta, contexto, data, freq }
          agentes: {},         // id -> { nome, funcao, conhecimentos, regras, fontes }
        };
        persistir();
      }
    }
    function persistir() {
      try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch(e) {}
    }

    // Embedding mock (384 dims) – determinístico por texto
    const EMBED_DIM = 384;
    function gerarEmbedding(texto) {
      let seed = 0;
      for (let i = 0; i < texto.length; i++) {
        seed = ((seed << 5) - seed + texto.charCodeAt(i)) | 0;
      }
      const pseudo = (s) => {
        s = Math.abs(s) % 2147483647;
        return ((s * 16807) % 2147483647) / 2147483647;
      };
      const vec = new Array(EMBED_DIM);
      let s = seed;
      for (let i = 0; i < EMBED_DIM; i++) {
        s = (s * 16807 + 1) % 2147483647;
        vec[i] = pseudo(s) * 2 - 1;
      }
      // Normalização L2
      let norm = 0;
      for (let i = 0; i < EMBED_DIM; i++) norm += vec[i] * vec[i];
      norm = Math.sqrt(norm) || 1;
      for (let i = 0; i < EMBED_DIM; i++) vec[i] /= norm;
      return vec;
    }

    function similaridadeCosseno(a, b) {
      let dot = 0;
      for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
      return dot; // vetores normalizados
    }

    function buscaKNN(embeddingConsulta, itens, k = 5) {
      return Object.values(itens)
        .map(item => ({ item, sim: similaridadeCosseno(embeddingConsulta, item.embedding || []) }))
        .sort((a, b) => b.sim - a.sim)
        .slice(0, k)
        .map(r => r.item);
    }

    // Operações públicas
    return {
      init() { loadStore(); },
      // Adicionar conceito
      adicionarConceito(id, nome, definicao, categoria, autor, tags = []) {
        const embedding = gerarEmbedding(definicao);
        store.conceitos[id] = {
          id, nome, definicao, categoria, autor,
          data_criacao: new Date().toISOString(),
          data_atualizacao: new Date().toISOString(),
          relacionamentos: [],
          tags,
          embedding
        };
        persistir();
      },
      // Adicionar documento
      adicionarDocumento(id, titulo, conteudo, fonte = 'IDEnza', autor = 'Sistema', tags = []) {
        const embedding = gerarEmbedding(conteudo);
        store.documentos[id] = {
          id, titulo, conteudo, fonte, autor,
          data_criacao: new Date().toISOString(),
          versao: 1,
          tags,
          embedding,
          relacionamentos: []
        };
        persistir();
      },
      // Adicionar relação
      adicionarRelacao(origem, destino, tipo = 'relacionado') {
        if (!store.relacoes[origem]) store.relacoes[origem] = [];
        store.relacoes[origem].push({ destino, tipo });
        persistir();
      },
      // Busca semântica em documentos
      buscarDocumentos(texto, k = 5) {
        const emb = gerarEmbedding(texto);
        return buscaKNN(emb, store.documentos, k);
      },
      // Busca semântica em conceitos
      buscarConceitos(texto, k = 5) {
        const emb = gerarEmbedding(texto);
        return buscaKNN(emb, store.conceitos, k);
      },
      // Cache
      cachear(pergunta, resposta, contextoIds) {
        const hash = btoa(pergunta).substring(0, 32);
        store.cache[hash] = {
          pergunta, resposta, contexto_usado: contextoIds,
          data: new Date().toISOString(), frequencia: 1
        };
        persistir();
      },
      consultarCache(pergunta, ttlMs = 3600000) {
        const hash = btoa(pergunta).substring(0, 32);
        const entry = store.cache[hash];
        if (!entry) return null;
        if (Date.now() - new Date(entry.data).getTime() > ttlMs) {
          delete store.cache[hash]; persistir(); return null;
        }
        entry.frequencia++;
        entry.data = new Date().toISOString();
        persistir();
        return entry.resposta;
      },
      // Histórico
      registrarHistorico(pergunta, resposta, contexto, agente = 'sistema') {
        store.historico.push({
          data: new Date().toISOString(),
          pergunta, resposta,
          contexto_usado: contexto,
          agente,
          score_confianca: 0.8
        });
        if (store.historico.length > 200) store.historico.shift();
        persistir();
      },
      // Agentes
      definirAgente(id, config) {
        store.agentes[id] = config;
        persistir();
      },
      // Vigilância
      verificarValidade() {
        const agora = Date.now();
        const expirados = [];
        Object.entries(store.documentos).forEach(([id, doc]) => {
          if (doc.data_revisao && new Date(doc.data_revisao).getTime() < agora) expirados.push(id);
        });
        return expirados;
      },
      // Dump para debug
      dump() { return store; }
    };
  })();

  // ======================== INTERFACE DO PAINEL (Nova Aba) ========================
  function criarPainelCerebro() {
    // Evita duplicação
    if (document.getElementById('tab-cerebro-semantico')) return;

    // Botão da nova aba
    const tabNav = document.querySelector('.tab-nav');
    const btnCerebro = document.createElement('button');
    btnCerebro.className = 'tab-btn brain-tab';
    btnCerebro.dataset.tab = 'tab-cerebro-semantico';
    btnCerebro.textContent = '🧠 Cérebro Semântico';
    tabNav.appendChild(btnCerebro);

    // Conteúdo da nova aba
    const tabContent = document.createElement('div');
    tabContent.className = 'tab-content brain-tab-content';
    tabContent.id = 'tab-cerebro-semantico';
    tabContent.innerHTML = `
      <div class="brain-header">
        <h2>🧠 Cérebro Semântico IDEnza</h2>
        <span class="brain-badge">7 Módulos</span>
      </div>
      <div class="brain-modules-grid">
        <!-- Módulo 1: Conceitos -->
        <div class="brain-module-card">
          <h3><span class="module-icon">📌</span> Conceitos</h3>
          <input class="brain-input" id="brain-conceito-id" placeholder="ID (ex: conceito.003)">
          <input class="brain-input" id="brain-conceito-nome" placeholder="Nome">
          <textarea class="brain-textarea" id="brain-conceito-def" placeholder="Definição..."></textarea>
          <input class="brain-input" id="brain-conceito-cat" placeholder="Categoria">
          <input class="brain-input" id="brain-conceito-autor" placeholder="Autor">
          <button class="brain-btn brain-btn-primary" id="brain-salvar-conceito">Salvar Conceito</button>
          <div class="brain-result-box" id="brain-conceitos-lista" style="max-height:150px;"></div>
        </div>

        <!-- Módulo 2: Documentos -->
        <div class="brain-module-card">
          <h3><span class="module-icon">📄</span> Documentos</h3>
          <input class="brain-input" id="brain-doc-id" placeholder="ID (ex: doc.001)">
          <input class="brain-input" id="brain-doc-titulo" placeholder="Título">
          <textarea class="brain-textarea" id="brain-doc-conteudo" placeholder="Conteúdo completo..."></textarea>
          <button class="brain-btn brain-btn-primary" id="brain-salvar-doc">Indexar Documento</button>
          <div class="brain-result-box" id="brain-docs-lista" style="max-height:150px;"></div>
        </div>

        <!-- Módulo 3: Relações -->
        <div class="brain-module-card">
          <h3><span class="module-icon">🔗</span> Relações</h3>
          <input class="brain-input" id="brain-rel-origem" placeholder="ID Origem">
          <input class="brain-input" id="brain-rel-destino" placeholder="ID Destino">
          <input class="brain-input" id="brain-rel-tipo" placeholder="Tipo (ex: explica, depende_de)">
          <button class="brain-btn brain-btn-outline" id="brain-salvar-rel">Adicionar Relação</button>
          <div class="brain-graph" id="brain-grafo"></div>
        </div>

        <!-- Módulo 4: Busca Semântica -->
        <div class="brain-module-card">
          <h3><span class="module-icon">🔍</span> Busca Semântica</h3>
          <input class="brain-input" id="brain-consulta" placeholder="Digite sua pergunta...">
          <div style="display:flex; gap:6px; margin:8px 0;">
            <button class="brain-btn brain-btn-success" id="brain-buscar-docs">Documentos</button>
            <button class="brain-btn brain-btn-success" id="brain-buscar-conceitos">Conceitos</button>
          </div>
          <div class="brain-result-box" id="brain-resultado-busca"></div>
        </div>

        <!-- Módulo 5: Cache Inteligente -->
        <div class="brain-module-card">
          <h3><span class="module-icon">⚡</span> Cache</h3>
          <textarea class="brain-textarea" id="brain-cache-pergunta" placeholder="Pergunta..."></textarea>
          <textarea class="brain-textarea" id="brain-cache-resposta" placeholder="Resposta..."></textarea>
          <button class="brain-btn brain-btn-warning" id="brain-cache-salvar">Armazenar no Cache</button>
          <button class="brain-btn brain-btn-outline" id="brain-cache-consultar" style="margin-top:6px;">Consultar Cache</button>
          <div class="brain-result-box" id="brain-cache-resultado" style="max-height:80px;"></div>
        </div>

        <!-- Módulo 6: Histórico -->
        <div class="brain-module-card">
          <h3><span class="module-icon">📜</span> Histórico</h3>
          <ul class="brain-hist-list" id="brain-historico-lista"></ul>
          <button class="brain-btn brain-btn-outline" id="brain-limpar-historico">Limpar</button>
        </div>

        <!-- Módulo 7: Agentes -->
        <div class="brain-module-card">
          <h3><span class="module-icon">🤖</span> Agentes</h3>
          <input class="brain-input" id="brain-agente-id" placeholder="ID do agente">
          <textarea class="brain-textarea" id="brain-agente-config" placeholder='{"nome":"...", "funcao":"...", "conhecimentos":["id1"], "regras":["..."], "fontes":["..."]}'></textarea>
          <button class="brain-btn brain-btn-primary" id="brain-salvar-agente">Registrar Agente</button>
          <div class="brain-result-box" id="brain-agentes-lista" style="max-height:100px;"></div>
        </div>
      </div>
      <div class="brain-status" id="brain-status-msg"></div>
    `;

    // Adiciona ao container principal
    document.querySelector('.tab-nav').insertAdjacentElement('afterend', tabContent);

    // Reaplica eventos de troca de aba (para incluir a nova aba)
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', function(e) {
        if (!this.dataset.tab) return;
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(tc => tc.classList.remove('active'));
        this.classList.add('active');
        document.getElementById(this.dataset.tab).classList.add('active');
      });
    });

    // Vincula eventos dos botões
    vincularEventos();
  }

  function vincularEventos() {
    // Salvar conceito
    document.getElementById('brain-salvar-conceito').addEventListener('click', () => {
      const id = document.getElementById('brain-conceito-id').value.trim();
      const nome = document.getElementById('brain-conceito-nome').value.trim();
      const def = document.getElementById('brain-conceito-def').value.trim();
      const cat = document.getElementById('brain-conceito-cat').value.trim();
      const autor = document.getElementById('brain-conceito-autor').value.trim();
      if (!id || !nome || !def) return alert('Preencha ID, Nome e Definição.');
      BrainEngine.adicionarConceito(id, nome, def, cat, autor);
      atualizarListaConceitos();
      statusMsg('Conceito salvo!', 'success');
    });

    // Salvar documento
    document.getElementById('brain-salvar-doc').addEventListener('click', () => {
      const id = document.getElementById('brain-doc-id').value.trim();
      const titulo = document.getElementById('brain-doc-titulo').value.trim();
      const conteudo = document.getElementById('brain-doc-conteudo').value.trim();
      if (!id || !titulo || !conteudo) return alert('Preencha todos os campos.');
      BrainEngine.adicionarDocumento(id, titulo, conteudo);
      atualizarListaDocumentos();
      statusMsg('Documento indexado!', 'success');
    });

    // Relação
    document.getElementById('brain-salvar-rel').addEventListener('click', () => {
      const origem = document.getElementById('brain-rel-origem').value.trim();
      const destino = document.getElementById('brain-rel-destino').value.trim();
      const tipo = document.getElementById('brain-rel-tipo').value.trim() || 'relacionado';
      if (!origem || !destino) return alert('Preencha Origem e Destino.');
      BrainEngine.adicionarRelacao(origem, destino, tipo);
      atualizarGrafo();
      statusMsg('Relação adicionada!', 'success');
    });

    // Busca documentos
    document.getElementById('brain-buscar-docs').addEventListener('click', () => {
      const query = document.getElementById('brain-consulta').value.trim();
      if (!query) return;
      const docs = BrainEngine.buscarDocumentos(query, 5);
      document.getElementById('brain-resultado-busca').textContent = JSON.stringify(docs.map(d => ({id: d.id, titulo: d.titulo, sim: '...' })), null, 2);
    });

    // Busca conceitos
    document.getElementById('brain-buscar-conceitos').addEventListener('click', () => {
      const query = document.getElementById('brain-consulta').value.trim();
      if (!query) return;
      const conceitos = BrainEngine.buscarConceitos(query, 5);
      document.getElementById('brain-resultado-busca').textContent = JSON.stringify(conceitos.map(c => ({id: c.id, nome: c.nome})), null, 2);
    });

    // Cache salvar
    document.getElementById('brain-cache-salvar').addEventListener('click', () => {
      const pergunta = document.getElementById('brain-cache-pergunta').value.trim();
      const resposta = document.getElementById('brain-cache-resposta').value.trim();
      if (!pergunta || !resposta) return;
      BrainEngine.cachear(pergunta, resposta, []);
      document.getElementById('brain-cache-resultado').textContent = 'Cache salvo.';
    });

    // Cache consultar
    document.getElementById('brain-cache-consultar').addEventListener('click', () => {
      const pergunta = document.getElementById('brain-cache-pergunta').value.trim();
      if (!pergunta) return;
      const resposta = BrainEngine.consultarCache(pergunta);
      document.getElementById('brain-cache-resultado').textContent = resposta || 'Cache vazio/expirado.';
    });

    // Agentes
    document.getElementById('brain-salvar-agente').addEventListener('click', () => {
      const id = document.getElementById('brain-agente-id').value.trim();
      const configRaw = document.getElementById('brain-agente-config').value.trim();
      if (!id || !configRaw) return alert('Preencha ID e configuração JSON.');
      try {
        const config = JSON.parse(configRaw);
        BrainEngine.definirAgente(id, config);
        atualizarListaAgentes();
        statusMsg('Agente registrado!', 'success');
      } catch(e) {
        alert('JSON inválido.');
      }
    });

    // Limpar histórico
    document.getElementById('brain-limpar-historico').addEventListener('click', () => {
      if (confirm('Limpar todo o histórico local?')) {
        BrainEngine.dump().historico = [];
        atualizarHistorico();
      }
    });

    // Atualizações iniciais
    atualizarListaConceitos();
    atualizarListaDocumentos();
    atualizarGrafo();
    atualizarHistorico();
    atualizarListaAgentes();
  }

  function statusMsg(msg, tipo) {
    const el = document.getElementById('brain-status-msg');
    if (el) {
      el.textContent = msg;
      el.className = 'brain-status ' + (tipo || '');
      setTimeout(() => { el.textContent = ''; el.className = 'brain-status'; }, 4000);
    }
  }

  function atualizarListaConceitos() {
    const el = document.getElementById('brain-conceitos-lista');
    if (!el) return;
    const conceitos = Object.values(BrainEngine.dump().conceitos);
    el.textContent = conceitos.map(c => `${c.id}: ${c.nome}`).join('\n') || 'Nenhum conceito.';
  }

  function atualizarListaDocumentos() {
    const el = document.getElementById('brain-docs-lista');
    if (!el) return;
    const docs = Object.values(BrainEngine.dump().documentos);
    el.textContent = docs.map(d => `${d.id}: ${d.titulo}`).join('\n') || 'Nenhum documento.';
  }

  function atualizarGrafo() {
    const el = document.getElementById('brain-grafo');
    if (!el) return;
    const rel = BrainEngine.dump().relacoes;
    let txt = '';
    Object.entries(rel).forEach(([origem, dests]) => {
      dests.forEach(d => { txt += `${origem} --[${d.tipo}]--> ${d.destino}\n`; });
    });
    el.textContent = txt || 'Sem relações.';
  }

  function atualizarHistorico() {
    const el = document.getElementById('brain-historico-lista');
    if (!el) return;
    const hist = BrainEngine.dump().historico.slice(-10).reverse();
    el.innerHTML = hist.map(h => `<li><span>${h.pergunta.substring(0,40)}</span><span style="color:#888;">${new Date(h.data).toLocaleString('pt-BR')}</span></li>`).join('');
  }

  function atualizarListaAgentes() {
    const el = document.getElementById('brain-agentes-lista');
    if (!el) return;
    const agentes = BrainEngine.dump().agentes;
    el.textContent = Object.keys(agentes).join(', ') || 'Nenhum agente.';
  }

  // Inicialização: ao carregar o DOM, injeta o painel
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      BrainEngine.init();
      criarPainelCerebro();
    });
  } else {
    BrainEngine.init();
    criarPainelCerebro();
  }

  // Expor motor globalmente para debug (opcional)
  window.BrainEngine = BrainEngine;

})();