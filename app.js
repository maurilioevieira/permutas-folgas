/**
 * CONTROLE DE PERMUTAS — GCM IGUATU
 * Front-end (GitHub Pages) — fala com o backend via fetch() ao Apps Script.
 *
 * IMPORTANTE: substitua API_URL abaixo pela URL da implantação do seu Apps Script
 * (Implantar > Nova implantação > Aplicativo da Web > copiar URL).
 */
const API_URL = 'https://script.google.com/macros/s/AKfycbyXdzgDFlPB1g0xrKS9veWOScBXSP96f4FMuJ_13Rd1OXfMyqHcgfil5Jw5sjHFMsyH/exec';

// ---------- ESTADO GLOBAL ----------
let usuario = JSON.parse(localStorage.getItem('permutas_usuario') || 'null');
let pinDigitado = '';
let cachePostos = [];
let cacheTurnos = [];
let cacheRecebidoPor = [];
let cacheFuncionarios = [];
let cachePermutas = [];
let cacheFolgas = [];

// ---------- COMUNICAÇÃO COM O BACKEND ----------
async function chamarApi(action, payload = {}) {
  if (usuario) payload.pin = usuario.pin;
  const resp = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // evita preflight CORS no Apps Script
    body: JSON.stringify({ action, payload })
  });
  const json = await resp.json();
  if (!json.ok) throw new Error(json.erro || 'Erro desconhecido.');
  return json.data;
}

// ---------- CONVERSÃO DE DATAS (input HTML usa yyyy-mm-dd; backend usa dd/mm/yyyy) ----------
function isoParaBR(iso) {
  if (!iso) return '';
  const [a, m, d] = iso.split('-');
  return `${d}/${m}/${a}`;
}
function brParaIso(br) {
  if (!br) return '';
  const [d, m, a] = br.split('/');
  return `${a}-${m}-${d}`;
}

// ================= TELA DE LOGIN (PIN) =================
const pinDisplay = document.getElementById('pin-display');
const pinErro = document.getElementById('pin-erro');

document.querySelectorAll('.pin-pad button[data-num]').forEach(btn => {
  btn.addEventListener('click', () => {
    if (pinDigitado.length >= 8) return;
    pinDigitado += btn.dataset.num;
    atualizarPinDisplay();
  });
});
document.getElementById('btn-limpar').addEventListener('click', () => { pinDigitado = ''; atualizarPinDisplay(); });
document.getElementById('btn-apagar').addEventListener('click', () => { pinDigitado = pinDigitado.slice(0, -1); atualizarPinDisplay(); });

function atualizarPinDisplay() {
  pinDisplay.textContent = '•'.repeat(pinDigitado.length);
  pinErro.textContent = '';
  if (pinDigitado.length >= 4) tentarLogin();
}

async function tentarLogin() {
  try {
    const dados = await chamarApiSemAuth('login', { pin: pinDigitado });
    usuario = { pin: pinDigitado, nome: dados.nome, nivel: dados.nivel };
    localStorage.setItem('permutas_usuario', JSON.stringify(usuario));
    entrarNoApp();
  } catch (e) {
    pinErro.textContent = 'PIN inválido.';
    pinDigitado = '';
    atualizarPinDisplay();
  }
}

// login não usa `usuario.pin` (ainda não existe), então chama a API direto
async function chamarApiSemAuth(action, payload) {
  const resp = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action, payload })
  });
  const json = await resp.json();
  if (!json.ok) throw new Error(json.erro || 'Erro desconhecido.');
  return json.data;
}

document.getElementById('btn-sair').addEventListener('click', () => {
  usuario = null;
  localStorage.removeItem('permutas_usuario');
  location.reload();
});

// ================= ENTRADA NO APP =================
function entrarNoApp() {
  document.getElementById('tela-login').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
  document.getElementById('usuario-logado').textContent = `${usuario.nome} (${usuario.nivel === 'admin' ? 'Administrador' : 'Auxiliar'})`;
  if (usuario.nivel === 'admin') {
    document.getElementById('aba-admin-botao').classList.remove('hidden');
  }
  carregarListasBase();
  carregarPermutas();
  carregarFolgas();
}

if (usuario) entrarNoApp();

// ================= NAVEGAÇÃO ENTRE ABAS =================
document.querySelectorAll('nav.abas button[data-aba]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('nav.abas button').forEach(b => b.classList.remove('ativa'));
    btn.classList.add('ativa');
    document.getElementById('secao-permutas').classList.toggle('hidden', btn.dataset.aba !== 'permutas');
    document.getElementById('secao-folgas').classList.toggle('hidden', btn.dataset.aba !== 'folgas');
    document.getElementById('secao-admin').classList.toggle('hidden', btn.dataset.aba !== 'admin');
    if (btn.dataset.aba === 'admin') renderizarAdmin();
  });
});

// ================= CARREGAR LISTAS BASE (postos, turnos, recebido por, funcionários) =================
async function carregarListasBase() {
  [cachePostos, cacheTurnos, cacheRecebidoPor, cacheFuncionarios] = await Promise.all([
    chamarApi('listPostos'),
    chamarApi('listTurnos'),
    chamarApi('listRecebidoPor'),
    chamarApi('listFuncionarios')
  ]);
  preencherSelect('permuta-posto', cachePostos);
  preencherSelect('permuta-turno', cacheTurnos.map(t => t.TURNO));
  preencherSelect('permuta-recebido-por', cacheRecebidoPor);
  preencherSelect('folga-posto', cachePostos);
}

function preencherSelect(idSelect, valores) {
  const sel = document.getElementById(idSelect);
  sel.innerHTML = '<option value="">Selecione...</option>' + valores.map(v => `<option value="${v}">${v}</option>`).join('');
}

// ================= LISTAGEM DE PERMUTAS =================
async function carregarPermutas(filtro = {}) {
  // ordenarPor: 'criado_desc' faz a última permuta cadastrada aparecer primeiro na tela
  cachePermutas = await chamarApi('listPermutas', { ordenarPor: 'criado_desc', ...filtro });
  renderizarTabelaPermutas();
  atualizarDestaqueHoje();
}

// ================= DESTAQUE DO DIA (permutas e folgas de hoje) =================
function dataHojeBR() {
  const d = new Date();
  const dia = String(d.getDate()).padStart(2, '0');
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  return `${dia}/${mes}/${d.getFullYear()}`;
}

async function atualizarDestaqueHoje() {
  const hoje = dataHojeBR();
  document.getElementById('destaque-data').textContent = hoje;
  try {
    const [permutasHoje, folgasHoje] = await Promise.all([
      chamarApi('listPermutas', { dataInicio: hoje, dataFim: hoje }),
      chamarApi('listFolgas', { dataInicio: hoje, dataFim: hoje })
    ]);
    renderizarListaDestaque('lista-permutas-hoje', permutasHoje,
      p => `${p.POSTO} — ${p.TURNO} · Escalado: ${p.ESCALADO} → Substituto: ${p.SUBSTITUTO}`);
    renderizarListaDestaque('lista-folgas-hoje', folgasHoje,
      f => `${f.QRA} — ${f.POSTO}${f.OBSERVACAO ? ' · ' + f.OBSERVACAO : ''}`);
  } catch (e) {
    console.error('Erro ao carregar destaque do dia:', e);
  }
}

function renderizarListaDestaque(idLista, itens, formatador) {
  const ul = document.getElementById(idLista);
  if (!itens || itens.length === 0) {
    ul.innerHTML = '<li class="mensagem-vazio">Nenhum registro para hoje.</li>';
    return;
  }
  ul.innerHTML = itens.map(i => `<li>${formatador(i)}</li>`).join('');
}

function renderizarTabelaPermutas() {
  const corpo = document.getElementById('corpo-tabela-permutas');
  if (cachePermutas.length === 0) {
    corpo.innerHTML = '<tr><td colspan="9" class="mensagem-vazio">Nenhuma permuta encontrada.</td></tr>';
    return;
  }
  corpo.innerHTML = cachePermutas.map(p => `
    <tr>
      <td>${p.DATA}</td><td>${p.POSTO}</td><td>${p.TURNO}</td>
      <td>${p.ESCALADO}</td><td>${p.SUBSTITUTO}</td><td>${p.HP}</td>
      <td>${p.RECEBIDO || ''}</td><td>${p.RECEBIDO_POR || ''}</td>
      <td>
        <button class="btn-secundario" onclick="abrirModalPermuta('${p.ID}')">Editar</button>
        <button class="btn-perigo" onclick="excluirPermuta('${p.ID}')">Excluir</button>
      </td>
    </tr>`).join('');
}

document.getElementById('btn-filtrar').addEventListener('click', () => {
  const ini = document.getElementById('filtro-data-inicio').value;
  const fim = document.getElementById('filtro-data-fim').value;
  carregarPermutas({ dataInicio: isoParaBR(ini), dataFim: isoParaBR(fim || ini) });
});
document.getElementById('btn-limpar-filtro').addEventListener('click', () => {
  document.getElementById('filtro-data-inicio').value = '';
  document.getElementById('filtro-data-fim').value = '';
  carregarPermutas();
});

// ================= MODAL DE PERMUTA (NOVA / EDITAR) =================
const modalPermuta = document.getElementById('modal-permuta');

document.getElementById('btn-nova-permuta').addEventListener('click', () => abrirModalPermuta(null));
document.getElementById('btn-cancelar-permuta').addEventListener('click', () => modalPermuta.classList.add('hidden'));

function abrirModalPermuta(id) {
  document.getElementById('form-permuta').reset();
  document.getElementById('permuta-id').value = '';
  document.getElementById('permuta-escalado-valor').value = '';
  document.getElementById('permuta-substituto-valor').value = '';
  document.getElementById('modal-permuta-titulo').textContent = id ? 'Editar Permuta' : 'Nova Permuta';

  if (id) {
    const p = cachePermutas.find(x => x.ID === id);
    document.getElementById('permuta-id').value = p.ID;
    document.getElementById('permuta-data').value = brParaIso(p.DATA);
    document.getElementById('permuta-posto').value = p.POSTO;
    document.getElementById('permuta-turno').value = p.TURNO;
    document.getElementById('permuta-escalado-busca').value = p.ESCALADO;
    document.getElementById('permuta-escalado-valor').value = p.ESCALADO;
    document.getElementById('permuta-substituto-busca').value = p.SUBSTITUTO;
    document.getElementById('permuta-substituto-valor').value = p.SUBSTITUTO;
    document.getElementById('permuta-recebido').value = brParaIso(p.RECEBIDO);
    document.getElementById('permuta-recebido-por').value = p.RECEBIDO_POR || '';
  }
  modalPermuta.classList.remove('hidden');
}

document.getElementById('form-permuta').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const id = document.getElementById('permuta-id').value;
  const payload = {
    id,
    data: isoParaBR(document.getElementById('permuta-data').value),
    posto: document.getElementById('permuta-posto').value,
    turno: document.getElementById('permuta-turno').value,
    escalado: document.getElementById('permuta-escalado-valor').value,
    substituto: document.getElementById('permuta-substituto-valor').value,
    recebido: isoParaBR(document.getElementById('permuta-recebido').value),
    recebidoPor: document.getElementById('permuta-recebido-por').value,
    usuarioNome: usuario.nome
  };
  try {
    if (id) await chamarApi('editPermuta', payload);
    else await chamarApi('addPermuta', payload);
    modalPermuta.classList.add('hidden');
    await carregarPermutas();
  } catch (e) {
    alert('Erro ao salvar: ' + e.message);
  }
});

async function excluirPermuta(id) {
  if (!confirm('Tem certeza que deseja excluir esta permuta?')) return;
  try {
    await chamarApi('deletePermuta', { id });
    await carregarPermutas();
  } catch (e) {
    alert('Erro ao excluir: ' + e.message);
  }
}

// ================= AUTOCOMPLETE (ESCALADO / SUBSTITUTO) =================
function configurarAutocomplete(idBusca, idValor, idLista) {
  const input = document.getElementById(idBusca);
  const valorOculto = document.getElementById(idValor);
  const lista = document.getElementById(idLista);

  input.addEventListener('input', () => {
    const termo = input.value.trim().toUpperCase();
    valorOculto.value = '';
    if (!termo) { lista.classList.add('hidden'); return; }
    const encontrados = cacheFuncionarios
      .filter(f => f.QRA && f.QRA.toUpperCase().includes(termo))
      .slice(0, 15);
    if (encontrados.length === 0) { lista.classList.add('hidden'); return; }
    lista.innerHTML = encontrados.map(f => `<div data-qra="${f.QRA}">${f.QRA}</div>`).join('');
    lista.classList.remove('hidden');
  });

  lista.addEventListener('click', (ev) => {
    if (ev.target.dataset.qra) {
      input.value = ev.target.dataset.qra;
      valorOculto.value = ev.target.dataset.qra;
      lista.classList.add('hidden');
    }
  });

  document.addEventListener('click', (ev) => {
    if (!ev.target.closest(`#${idBusca}`) && !ev.target.closest(`#${idLista}`)) {
      lista.classList.add('hidden');
    }
  });
}
configurarAutocomplete('permuta-escalado-busca', 'permuta-escalado-valor', 'lista-autocomplete-escalado');
configurarAutocomplete('permuta-substituto-busca', 'permuta-substituto-valor', 'lista-autocomplete-substituto');

// ================= GERAÇÃO DE PDF =================
async function gerarEBaixarPdf(action, botao) {
  const textoOriginal = botao.textContent;
  botao.disabled = true;
  botao.textContent = 'Gerando PDF... (pode levar alguns segundos)';

  const ini = document.getElementById('filtro-data-inicio').value;
  const fim = document.getElementById('filtro-data-fim').value;
  const payload = { dataInicio: isoParaBR(ini), dataFim: isoParaBR(fim || ini) };

  try {
    let dados;
    try {
      dados = await chamarApi(action, payload);
    } catch (primeiroErro) {
      // Primeira chamada após o script ficar inativo pode demorar ou falhar (cold start do Apps Script).
      // Tenta uma segunda vez automaticamente antes de mostrar erro ao usuário.
      botao.textContent = 'Ainda gerando, tentando novamente...';
      dados = await chamarApi(action, payload);
    }
    if (!dados || !dados.base64) throw new Error('O servidor não retornou o PDF corretamente.');
    const link = document.createElement('a');
    link.href = 'data:application/pdf;base64,' + dados.base64;
    link.download = dados.nomeArquivo;
    link.click();
  } catch (e) {
    alert('Erro ao gerar PDF: ' + e.message + '\n\nSe o erro persistir, aguarde alguns segundos e tente novamente — o Google às vezes demora para "acordar" o script depois de um tempo parado.');
  } finally {
    botao.disabled = false;
    botao.textContent = textoOriginal;
  }
}
document.getElementById('btn-pdf-permutas').addEventListener('click', (ev) => gerarEBaixarPdf('gerarPdfPermutas', ev.target));
document.getElementById('btn-pdf-combinado').addEventListener('click', (ev) => gerarEBaixarPdf('gerarPdfPermutasFolgas', ev.target));

// ================= LISTAGEM DE FOLGAS =================
async function carregarFolgas(filtro = {}) {
  cacheFolgas = await chamarApi('listFolgas', { ordenarPor: 'criado_desc', ...filtro });
  renderizarTabelaFolgas();
  atualizarDestaqueHoje();
}

function renderizarTabelaFolgas() {
  const corpo = document.getElementById('corpo-tabela-folgas');
  if (cacheFolgas.length === 0) {
    corpo.innerHTML = '<tr><td colspan="5" class="mensagem-vazio">Nenhuma folga encontrada.</td></tr>';
    return;
  }
  corpo.innerHTML = cacheFolgas.map(f => `
    <tr>
      <td>${f.DATA}</td><td>${f.QRA}</td><td>${f.POSTO}</td><td>${f.OBSERVACAO || ''}</td>
      <td>
        <button class="btn-secundario" onclick="abrirModalFolga('${f.ID}')">Editar</button>
        <button class="btn-perigo" onclick="excluirFolga('${f.ID}')">Excluir</button>
      </td>
    </tr>`).join('');
}

document.getElementById('btn-filtrar-folgas').addEventListener('click', () => {
  const ini = document.getElementById('filtro-folga-data-inicio').value;
  const fim = document.getElementById('filtro-folga-data-fim').value;
  carregarFolgas({ dataInicio: isoParaBR(ini), dataFim: isoParaBR(fim || ini) });
});
document.getElementById('btn-limpar-filtro-folgas').addEventListener('click', () => {
  document.getElementById('filtro-folga-data-inicio').value = '';
  document.getElementById('filtro-folga-data-fim').value = '';
  carregarFolgas();
});

// ================= MODAL DE FOLGA (NOVA / EDITAR) =================
const modalFolga = document.getElementById('modal-folga');

document.getElementById('btn-nova-folga').addEventListener('click', () => abrirModalFolga(null));
document.getElementById('btn-cancelar-folga').addEventListener('click', () => modalFolga.classList.add('hidden'));

function abrirModalFolga(id) {
  document.getElementById('form-folga').reset();
  document.getElementById('folga-id').value = '';
  document.getElementById('folga-qra-valor').value = '';
  document.getElementById('modal-folga-titulo').textContent = id ? 'Editar Folga' : 'Nova Folga';

  if (id) {
    const f = cacheFolgas.find(x => x.ID === id);
    document.getElementById('folga-id').value = f.ID;
    document.getElementById('folga-qra-busca').value = f.QRA;
    document.getElementById('folga-qra-valor').value = f.QRA;
    document.getElementById('folga-data').value = brParaIso(f.DATA);
    document.getElementById('folga-posto').value = f.POSTO;
    document.getElementById('folga-observacao').value = f.OBSERVACAO || '';
  }
  modalFolga.classList.remove('hidden');
}

document.getElementById('form-folga').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const id = document.getElementById('folga-id').value;
  const payload = {
    id,
    qra: document.getElementById('folga-qra-valor').value,
    data: isoParaBR(document.getElementById('folga-data').value),
    posto: document.getElementById('folga-posto').value,
    observacao: document.getElementById('folga-observacao').value,
    usuarioNome: usuario.nome
  };
  try {
    if (id) await chamarApi('editFolga', payload);
    else await chamarApi('addFolga', payload);
    modalFolga.classList.add('hidden');
    await carregarFolgas();
  } catch (e) {
    alert('Erro ao salvar: ' + e.message);
  }
});

async function excluirFolga(id) {
  if (!confirm('Tem certeza que deseja excluir esta folga?')) return;
  try {
    await chamarApi('deleteFolga', { id });
    await carregarFolgas();
  } catch (e) {
    alert('Erro ao excluir: ' + e.message);
  }
}

configurarAutocomplete('folga-qra-busca', 'folga-qra-valor', 'lista-autocomplete-folga-qra');

// ================= PAINEL ADMIN =================
function renderizarAdmin() {
  renderizarListaAdmin('lista-postos', cachePostos, (valor) => excluirItemAdmin('deletePosto', { posto: valor }));
  renderizarListaAdmin('lista-turnos', cacheTurnos.map(t => `${t.TURNO} (${t.HORAS}h)`), null, cacheTurnos.map(t => t.TURNO), (valor) => excluirItemAdmin('deleteTurno', { turno: valor }));
  renderizarListaAdmin('lista-recebido-por', cacheRecebidoPor, (valor) => excluirItemAdmin('deleteRecebidoPor', { nome: valor }));
  renderizarListaAdmin('lista-funcionarios', cacheFuncionarios.map(f => f.QRA), (valor) => excluirItemAdmin('deleteFuncionario', { qra: valor }));
}

function renderizarListaAdmin(idLista, textos, aoExcluir, valoresReais, aoExcluirComValorReal) {
  const ul = document.getElementById(idLista);
  if (textos.length === 0) { ul.innerHTML = '<li class="mensagem-vazio">Nenhum registro.</li>'; return; }
  ul.innerHTML = textos.map((t, i) => {
    const valor = valoresReais ? valoresReais[i] : t;
    return `<li>${t} <button class="btn-perigo" data-valor="${valor}">remover</button></li>`;
  }).join('');
  ul.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!confirm('Remover este registro?')) return;
      (aoExcluirComValorReal || aoExcluir)(btn.dataset.valor);
    });
  });
}

async function excluirItemAdmin(action, payload) {
  try {
    await chamarApi(action, payload);
    await carregarListasBase();
    renderizarAdmin();
  } catch (e) {
    alert('Erro: ' + e.message);
  }
}

document.getElementById('form-add-posto').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const input = document.getElementById('input-novo-posto');
  try {
    await chamarApi('addPosto', { posto: input.value.toUpperCase() });
    input.value = '';
    await carregarListasBase();
    renderizarAdmin();
  } catch (e) { alert('Erro: ' + e.message); }
});

document.getElementById('form-add-turno').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const nome = document.getElementById('input-novo-turno');
  const horas = document.getElementById('input-novo-turno-horas');
  try {
    await chamarApi('addTurno', { turno: nome.value.toUpperCase(), horas: horas.value });
    nome.value = ''; horas.value = '';
    await carregarListasBase();
    renderizarAdmin();
  } catch (e) { alert('Erro: ' + e.message); }
});

document.getElementById('form-add-recebido-por').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const input = document.getElementById('input-novo-recebido-por');
  try {
    await chamarApi('addRecebidoPor', { nome: input.value.toUpperCase() });
    input.value = '';
    await carregarListasBase();
    renderizarAdmin();
  } catch (e) { alert('Erro: ' + e.message); }
});

document.getElementById('form-add-funcionario').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const nome = document.getElementById('input-func-nome');
  const classe = document.getElementById('input-func-classe');
  const qra = document.getElementById('input-func-qra');
  const email = document.getElementById('input-func-email');
  try {
    await chamarApi('addFuncionario', { nomeCompleto: nome.value, classe: classe.value, qra: qra.value.toUpperCase(), email: email.value });
    nome.value = ''; classe.value = ''; qra.value = ''; email.value = '';
    await carregarListasBase();
    renderizarAdmin();
  } catch (e) { alert('Erro: ' + e.message); }
});
