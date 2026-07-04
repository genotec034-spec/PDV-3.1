// Base de dados padrão reativa no LocalStorage
let produtosDB = JSON.parse(localStorage.getItem('pdv_v3_produtos')) || [
    { id: "7891234567890", name: "Refrigerante Lata 350ml", price: 4.50, stock: 95 },
    { id: "7891000000001", name: "Água Mineral 500ml", price: 2.50, stock: 150 },
    { id: "7892000000002", name: "Salgado Assado Frango", price: 7.00, stock: 40 }
];

let vendasDB = JSON.parse(localStorage.getItem('pdv_v3_vendas')) || [];

let caixaStatus = JSON.parse(localStorage.getItem('pdv_v3_caixa_status')) || {
    estado: "fechado",
    valorAbertura: 0,
    totalVendas: 0,
    suprimentos: 0,
    sangrias: 0,
    logs: []
};

let empresaConfig = JSON.parse(localStorage.getItem('pdv_v3_empresa')) || {
    nome: "MINHA LOJA PRO",
    cnpj: "CNPJ: 00.000.000/0001-00",
    endereco: "Rua Principal, 123",
    bobina: "80mm"
};

let carrinho = [];
let multiplicadorQtd = 1;
let modoEntradaAtivo = "barcode"; 

document.addEventListener('DOMContentLoaded', () => {
    sincronizarLayoutIdentidadeEmpresa();
    atualizarVisualBloqueioCaixa();
    renderProdutosTable();
    renderHistoricoLogsFluxo();
    renderHistoricoGeralVendas();
    configurarNavegacaoAbas();
    configurarTemaEscuro();
    mapearAtalhosTecladoGlobais();
});

function sincronizarLayoutIdentidadeEmpresa() {
    document.getElementById('receipt-store-name').innerText = empresaConfig.nome;
    document.getElementById('receipt-store-sub').innerText = `${empresaConfig.cnpj} | ${empresaConfig.endereco}`;
    document.getElementById('cfg-store-name').value = empresaConfig.nome;
    document.getElementById('cfg-store-cnpj').value = empresaConfig.cnpj;
    document.getElementById('cfg-store-address').value = empresaConfig.endereco;
    document.getElementById('cfg-printer-width').value = empresaConfig.bobina;
}

function salvarConfiguracoesIdentidadeEmpresa() {
    empresaConfig.nome = document.getElementById('cfg-store-name').value.trim() || "MINHA LOJA PRO";
    empresaConfig.cnpj = document.getElementById('cfg-store-cnpj').value.trim() || "CNPJ: 00.000.000/0001-00";
    empresaConfig.endereco = document.getElementById('cfg-store-address').value.trim() || "Rua Principal, 123";
    empresaConfig.bobina = document.getElementById('cfg-printer-width').value;
    
    localStorage.setItem('pdv_v3_empresa', JSON.stringify(empresaConfig));
    sincronizarLayoutIdentidadeEmpresa();
    alert("Configurações atualizadas com sucesso!");
}

function atualizarVisualBloqueioCaixa() {
    const overlay = document.getElementById('caixa-bloqueio-overlay');
    const badge = document.getElementById('caixa-status-badge');
    const txtFull = document.getElementById('txt-caixa-status-full');
    const painelInfo = document.getElementById('caixa-status-painel-info');
    const containerAbrir = document.getElementById('fluxo-abrir-container');
    const containerOperando = document.getElementById('fluxo-operando-container');

    if (caixaStatus.estado === "aberto") {
        overlay.classList.remove('full-visible');
        badge.className = "status-indicator online";
        badge.innerHTML = '<span class="pulse-dot"></span> CAIXA OPERANDO';
        txtFull.innerText = "ABERTO / EM ATENDIMENTO";
        painelInfo.className = "caixa-painel-info aberto";
        containerAbrir.classList.add('hidden');
        containerOperando.classList.remove('hidden');
    } else {
        overlay.classList.add('full-visible');
        badge.className = "status-indicator offline";
        badge.innerHTML = '<span class="pulse-dot red-dot"></span> CAIXA FECHADO';
        txtFull.innerText = "FECHADO / TURNO ENCERRADO";
        painelInfo.className = "caixa-painel-info fechado";
        containerAbrir.classList.remove('hidden');
        containerOperando.classList.add('hidden');
    }
    recalcularBalanceteTurno();
}

function irParaAbaCaixaFluxo() {
    document.querySelectorAll('.nav-btn').forEach(btn => {
        if(btn.dataset.tab === 'fluxo-caixa') btn.click();
    });
}

function realizarAberturaCaixa() {
    const valorInput = parseFloat(document.getElementById('caixa-abertura-valor').value);
    if (isNaN(valorInput) || valorInput < 0) return alert("Informe um valor de troco inicial válido!");
    
    caixaStatus.estado = "aberto";
    caixaStatus.valorAbertura = valorInput;
    caixaStatus.totalVendas = 0;
    caixaStatus.suprimentos = 0;
    caixaStatus.sangrias = 0;
    caixaStatus.logs = [];
    
    registrarLogInternoCaixa("ABERTURA DE TURNO", valorInput, "Início do turno operacional");
    salvarEstadoCaixaNoStorage();
    atualizarVisualBloqueioCaixa();
    
    document.querySelectorAll('.nav-btn').forEach(btn => {
        if(btn.dataset.tab === 'caixa') btn.click();
    });
}

function lancarMovimentacaoAvulsaCaixa() {
    const tipo = document.getElementById('fluxo-mov-tipo').value;
    const valor = parseFloat(document.getElementById('fluxo-mov-valor').value);
    const motivo = document.getElementById('fluxo-mov-motivo').value.trim() || "Movimentação manual";

    if (isNaN(valor) || valor <= 0) return alert("Digite um valor maior que zero.");

    if (tipo === "suprimento") {
        caixaStatus.suprimentos += valor;
        registrarLogInternoCaixa("SUPRIMENTO", valor, motivo);
    } else {
        const saldoCalculado = caixaStatus.valorAbertura + caixaStatus.totalVendas + caixaStatus.suprimentos - caixaStatus.sangrias;
        if (valor > saldoCalculado) return alert("Saldo insuficiente em caixa para realizar esta sangria!");
        caixaStatus.sangrias += valor;
        registrarLogInternoCaixa("SANGRIA", valor, motivo);
    }

    document.getElementById('fluxo-mov-valor').value = '';
    document.getElementById('fluxo-mov-motivo').value = '';
    salvarEstadoCaixaNoStorage();
    recalcularBalanceteTurno();
    renderHistoricoLogsFluxo();
    alert("Lançamento inserido com sucesso!");
}

function realizarFechamentoCaixa() {
    const saldoEsperado = caixaStatus.valorAbertura + caixaStatus.totalVendas + caixaStatus.suprimentos - caixaStatus.sangrias;
    
    if (confirm(`Deseja encerrar este turno?\\n\\nFundo Inicial: ${formatarMoeda(caixaStatus.valorAbertura)}\\nVendas Líquidas: ${formatarMoeda(caixaStatus.totalVendas)}\\nSuprimentos: ${formatarMoeda(caixaStatus.suprimentos)}\\nSangrias: ${formatarMoeda(caixaStatus.sangrias)}\\nSaldo Final Estimado: ${formatarMoeda(saldoEsperado)}`)) {
        caixaStatus.estado = "fechado";
        salvarEstadoCaixaNoStorage();
        atualizarVisualBloqueioCaixa();
        window.location.reload();
    }
}

function registrarLogInternoCaixa(operacao, valor, motivo) {
    const hora = new Date().toLocaleTimeString('pt-BR');
    caixaStatus.logs.push({ hora, operacao, valor, motivo });
}

function salvarEstadoCaixaNoStorage() {
    localStorage.setItem('pdv_v3_caixa_status', JSON.stringify(caixaStatus));
}

function recalcularBalanceteTurno() {
    const saldoEsperado = caixaStatus.valorAbertura + caixaStatus.totalVendas + caixaStatus.suprimentos - caixaStatus.sangrias;
    document.getElementById('fin-txt-inicial').innerText = formatarMoeda(caixaStatus.valorAbertura);
    document.getElementById('fin-txt-vendas').innerText = formatarMoeda(caixaStatus.totalVendas);
    document.getElementById('fin-txt-suprimentos').innerText = formatarMoeda(caixaStatus.suprimentos);
    document.getElementById('fin-txt-sangrias').innerText = formatarMoeda(caixaStatus.sangrias);
    document.getElementById('fin-txt-saldo-real').innerText = formatarMoeda(saldoEsperado);
}

function renderHistoricoLogsFluxo() {
    const tbody = document.getElementById('fluxo-logs-tbody');
    if (caixaStatus.logs.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: var(--texto-silenciado);">Nenhum log no turno ativo.</td></tr>';
        return;
    }
    tbody.innerHTML = '';
    caixaStatus.logs.forEach(log => {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${log.hora}</td><td><strong>${log.operacao}</strong></td><td class="${log.operacao.includes('SANGRIA') ? 'text-danger' : 'text-success'}">${formatarMoeda(log.valor)}</td><td>${log.motivo}</td>`;
        tbody.insertBefore(tr, tbody.firstChild);
    });
}

function setModoEntrada(modo) {
    modoEntradaAtivo = modo;
    const btnBarcode = document.getElementById('mode-barcode');
    const btnManual = document.getElementById('mode-manual');
    const wrapBarcode = document.getElementById('wrapper-input-barcode');
    const wrapManual = document.getElementById('wrapper-input-manual');

    if (modo === 'barcode') {
        btnBarcode.classList.add('active'); btnManual.classList.remove('active');
        wrapBarcode.classList.remove('hidden'); wrapManual.classList.add('hidden');
        document.getElementById('barcode-input').focus();
    } else {
        btnBarcode.classList.remove('active'); btnManual.classList.add('active');
        wrapBarcode.classList.add('hidden'); wrapManual.classList.remove('hidden');
        document.getElementById('manual-item-desc').focus();
    }
}

function adicionarItemManualAvulso() {
    const desc = document.getElementById('manual-item-desc').value.trim();
    const preco = parseFloat(document.getElementById('manual-item-price').value);
    const qtd = parseFloat(document.getElementById('manual-item-qty').value);

    if (!desc || isNaN(preco) || preco <= 0 || isNaN(qtd) || qtd <= 0) return alert("Preencha todos os campos corretamente!");

    const produtoVirtual = { id: "AVULSO-" + Math.floor(100 + Math.random() * 900), name: desc, price: preco, stock: 999 };
    carrinho.push({ itemNo: carrinho.length + 1, produto: produtoVirtual, qtd: qtd });

    document.getElementById('current-item-title').innerText = produtoVirtual.name;
    document.getElementById('current-item-qty').innerText = qtd;
    document.getElementById('current-item-unit').innerText = formatarMoeda(preco);
    document.getElementById('current-item-total').innerText = formatarMoeda(preco * qtd);

    document.getElementById('manual-item-desc').value = '';
    document.getElementById('manual-item-price').value = '';
    document.getElementById('manual-item-qty').value = '1';

    atualizarInterfaceCarrinho();
    if(window.innerWidth > 600) document.getElementById('manual-item-desc').focus();
}

const barcodeInput = document.getElementById('barcode-input');
barcodeInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        const cod = barcodeInput.value.trim();
        if (!cod) return;
        processarBipeProduto(cod);
    }
});

function processarBipeProduto(codigo) {
    const produto = produtosDB.find(p => p.id === codigo);
    if (produto) {
        const itemExistente = carrinho.find(i => i.produto.id === codigo);
        if (itemExistente) itemExistente.qtd += multiplicadorQtd;
        else carrinho.push({ itemNo: carrinho.length + 1, produto: produto, qtd: multiplicadorQtd });

        document.getElementById('current-item-title').innerText = produto.name;
        document.getElementById('current-item-qty').innerText = multiplicadorQtd;
        document.getElementById('current-item-unit').innerText = formatarMoeda(produto.price);
        document.getElementById('current-item-total').innerText = formatarMoeda(produto.price * multiplicadorQtd);

        multiplicadorQtd = 1; barcodeInput.value = '';
        atualizarInterfaceCarrinho();
    } else {
        alert(`SKU/Código "${codigo}" não localizado!`);
        barcodeInput.value = '';
    }
}

function definirMultiplicadorQuantidade() {
    const input = prompt("Digite a quantidade multiplicadora:");
    if (input && !isNaN(input) && parseFloat(input) > 0) {
        multiplicadorQtd = parseFloat(input);
        document.getElementById('current-item-qty').innerText = multiplicadorQtd;
    }
}

function removerUltimoItem() { if (carrinho.length > 0) { carrinho.pop(); atualizarInterfaceCarrinho(); } }
function limparVendaAtiva() { if (carrinho.length > 0 && confirm("Limpar cupom?")) { carrinho = []; multiplicadorQtd = 1; atualizarInterfaceCarrinho(); } }

function atualizarInterfaceCarrinho() {
    const tbody = document.getElementById('cart-items-tbody');
    if (carrinho.length === 0) {
        tbody.innerHTML = '<tr class="empty-cart-row"><td colspan="5" style="text-align: center; color: var(--texto-silenciado); padding: 40px 0;">Cupom vazio.</td></tr>';
        document.getElementById('summary-subtotal').innerText = "R$ 0,00";
        document.getElementById('summary-total').innerText = "R$ 0,00";
        document.getElementById('current-item-title').innerText = "NENHUM ITEM NA TELA";
        return;
    }
    tbody.innerHTML = ''; let subtotal = 0;
    carrinho.forEach((item, idx) => {
        const totalItem = item.produto.price * item.qtd; subtotal += totalItem;
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${idx + 1}</td><td>${item.produto.name}</td><td>${item.qtd}</td><td>${formatarMoeda(item.produto.price)}</td><td>${formatarMoeda(totalItem)}</td>`;
        tbody.appendChild(tr);
    });
    document.getElementById('summary-subtotal').innerText = formatarMoeda(subtotal);
    document.getElementById('summary-total').innerText = formatarMoeda(subtotal);
}

function abrirModalPagamento() {
    if (carrinho.length === 0) return alert("Não há itens para faturar!");
    const subtotal = carrinho.reduce((acc, i) => acc + (i.produto.price * i.qtd), 0);
    document.getElementById('modal-pay-total-value').innerText = formatarMoeda(subtotal);
    document.getElementById('modal-pay-received').value = subtotal.toFixed(2);
    document.getElementById('modal-pay-discount').value = "0.00";
    calcularTrocoOperacional();
    document.getElementById('payment-modal').classList.add('active');
    setTimeout(() => document.getElementById('modal-pay-received').select(), 100);
}

function fecharModalPagamento() { document.getElementById('payment-modal').classList.remove('active'); if(modoEntradaAtivo === 'barcode') barcodeInput.focus(); }

function calcularTrocoOperacional() {
    const subtotal = carrinho.reduce((acc, i) => acc + (i.produto.price * i.qtd), 0);
    const desconto = parseFloat(document.getElementById('modal-pay-discount').value) || 0;
    const totalComDesconto = Math.max(0, subtotal - desconto);
    const recebido = parseFloat(document.getElementById('modal-pay-received').value) || 0;
    const metodo = document.getElementById('modal-pay-method').value;
    const cashFields = document.getElementById('payment-cash-fields');

    if (metodo === "Dinheiro") {
        cashFields.classList.remove('hidden');
        document.getElementById('modal-pay-change-value').innerText = formatarMoeda(Math.max(0, recebido - totalComDesconto));
    } else {
        cashFields.classList.add('hidden');
        document.getElementById('modal-pay-received').value = totalComDesconto.toFixed(2);
        document.getElementById('modal-pay-change-value').innerText = "R$ 0,00";
    }
}

function recalcularTotalComDescontoNoModal() {
    const subtotal = carrinho.reduce((acc, i) => acc + (i.produto.price * i.qtd), 0);
    const desconto = parseFloat(document.getElementById('modal-pay-discount').value) || 0;
    const totalComDesconto = Math.max(0, subtotal - desconto);

    document.getElementById('modal-pay-total-value').innerText = formatarMoeda(totalComDesconto);
    document.getElementById('summary-discount').innerText = formatarMoeda(desconto);
    if (document.getElementById('modal-pay-method').value !== "Dinheiro") {
        document.getElementById('modal-pay-received').value = totalComDesconto.toFixed(2);
    }
    calcularTrocoOperacional();
}

function processarEfetivacaoVendaFinal() {
    const subtotal = carrinho.reduce((acc, i) => acc + (i.produto.price * i.qtd), 0);
    const desconto = parseFloat(document.getElementById('modal-pay-discount').value) || 0;
    const totalFinal = Math.max(0, subtotal - desconto);
    const metodo = document.getElementById('modal-pay-method').value;

    carrinho.forEach(item => {
        const realProd = produtosDB.find(p => p.id === item.produto.id);
        if (realProd && realProd.id.indexOf("AVULSO-") === -1) realProd.stock = Math.max(0, realProd.stock - item.qtd);
    });

    caixaStatus.totalVendas += totalFinal;
    registrarLogInternoCaixa(`VENDA ELETRÔNICA`, totalFinal, `Faturamento via ${metodo}`);

    const novaVendaObj = {
        id: "VND-" + Math.floor(10000 + Math.random() * 90000),
        timestamp: new Date().toLocaleString('pt-BR'),
        metodo: metodo,
        volumes: carrinho.reduce((acc, i) => acc + i.qtd, 0),
        total: totalFinal,
        itens: JSON.parse(JSON.stringify(carrinho)),
        desconto: desconto
    };

    vendasDB.unshift(novaVendaObj);
    localStorage.setItem('pdv_v3_vendas', JSON.stringify(vendasDB));
    localStorage.setItem('pdv_v3_produtos', JSON.stringify(produtosDB));
    salvarEstadoCaixaNoStorage();

    dispararFluxoImpressaoBobinaTermica(novaVendaObj);

    carrinho = []; multiplicadorQtd = 1;
    fecharModalPagamento(); atualizarInterfaceCarrinho();
    renderProdutosTable(); renderHistoricoLogsFluxo(); renderHistoricoGeralVendas(); recalcularBalanceteTurno();
    alert("Venda efetivada com sucesso!");
}

function dispararFluxoImpressaoBobinaTermica(venda) {
    const printArea = document.getElementById('thermal-print-area');
    printArea.className = `thermal-print-layout width-${empresaConfig.bobina}`;

    let htmlCupom = `
        <div class="thermal-header">
            <strong>${empresaConfig.nome}</strong><br>${empresaConfig.cnpj}<br>${empresaConfig.endereco}<br>
            <div class="thermal-divider"></div><strong>CUPOM DE VENDA</strong>
        </div>
        <div class="thermal-row"><span>DOC: ${venda.id}</span><span>${venda.timestamp.split(' ')[1]}</span></div>
        <span>DATA: ${venda.timestamp.split(' ')[0]}</span>
        <div class="thermal-divider"></div>
        <table class="thermal-table">
            <thead><tr><th>DESC</th><th>QTD</th><th>VL_UN</th><th>TOTAL</th></tr></thead>
            <tbody>`;

    venda.itens.forEach(item => {
        htmlCupom += `<tr><td>${item.produto.name.substring(0, 16)}</td><td>${item.qtd}</td><td>${item.produto.price.toFixed(2)}</td><td>${(item.produto.price * item.qtd).toFixed(2)}</td></tr>`;
    });

    htmlCupom += `</tbody></table>
        <div class="thermal-divider"></div>
        <div class="thermal-row"><span>SUBTOTAL</span> <span>${formatarMoeda(venda.total + venda.desconto)}</span></div>
        <div class="thermal-row"><span>DESCONTO</span> <span>${formatarMoeda(venda.desconto)}</span></div>
        <div class="thermal-row" style="font-weight:bold;"><span>TOTAL PAGO</span> <span>${formatarMoeda(venda.total)}</span></div>
        <div class="thermal-row"><span>PAGAMENTO</span> <span>${venda.metodo.toUpperCase()}</span></div>
        <div class="thermal-divider"></div>
        <div class="thermal-footer">Obrigado pela preferência!</div>`;

    printArea.innerHTML = htmlCupom;
    setTimeout(() => { window.print(); }, 50);
}

function reimprimirCupomAntigoHistorico(idVenda) {
    const v = vendasDB.find(x => x.id === idVenda);
    if(v) dispararFluxoImpressaoBobinaTermica(v);
}

document.getElementById('product-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const id = document.getElementById('prod-code').value.trim();
    const name = document.getElementById('prod-name').value.trim();
    const price = parseFloat(document.getElementById('prod-price').value);
    const stock = parseInt(document.getElementById('prod-stock').value);

    if (produtosDB.some(p => p.id === id)) return alert("Este código de barras / SKU já existe!");

    produtosDB.push({ id, name, price, stock });
    localStorage.setItem('pdv_v3_produtos', JSON.stringify(produtosDB));
    document.getElementById('product-form').reset();
    renderProdutosTable();
    alert("Produto inserido com sucesso!");
});

function processarImportacaoProdutosEmMassa() {
    const rawText = document.getElementById('import-json-textarea').value.trim();
    if(!rawText) return alert("Insira uma lista JSON válida.");
    try {
        const arrParsed = JSON.parse(rawText);
        if(!Array.isArray(arrParsed)) throw new Error("A raiz deve ser uma lista []");
        let inseridos = 0;
        arrParsed.forEach(item => {
            if(item.id && item.name && !isNaN(item.price)) {
                if(!produtosDB.some(p => p.id == item.id)) {
                    produtosDB.push({ id: String(item.id), name: String(item.name), price: parseFloat(item.price), stock: parseInt(item.stock) || 0 });
                    inseridos++;
                }
            }
        });
        localStorage.setItem('pdv_v3_produtos', JSON.stringify(produtosDB));
        renderProdutosTable();
        document.getElementById('import-json-textarea').value = '';
        alert(`Sucesso! ${inseridos} novos produtos foram adicionados.`);
    } catch (err) {
        alert("Erro na estrutura do JSON: " + err.message);
    }
}

function renderProdutosTable(filtro = '') {
    const tbody = document.getElementById('products-list-tbody'); tbody.innerHTML = ''; let valuation = 0;
    produtosDB.forEach(prod => {
        valuation += (prod.price * prod.stock);
        if (filtro && !prod.id.includes(filtro) && !prod.name.toLowerCase().includes(filtro.toLowerCase())) return;
        const tr = document.createElement('tr');
        tr.innerHTML = `<td style="font-family: monospace; font-weight:bold;">${prod.id}</td><td>${prod.name}</td><td>${formatarMoeda(prod.price)}</td><td><strong>${prod.stock} un</strong></td><td style="text-align: center;"><button class="row-action-btn delete" onclick="removerItemDBCompleto('${prod.id}')"><i class="fa-solid fa-trash-can"></i></button></td>`;
        tbody.appendChild(tr);
    });
    document.getElementById('prod-count').innerText = produtosDB.length;
    document.getElementById('total-stock-valuation').innerText = formatarMoeda(valuation);
}

function removerItemDBCompleto(id) {
    if(confirm("Deseja deletar este produto do estoque definitivo?")) {
        produtosDB = produtosDB.filter(p => p.id !== id);
        localStorage.setItem('pdv_v3_produtos', JSON.stringify(produtosDB));
        renderProdutosTable();
    }
}

document.getElementById('search-product').addEventListener('input', (e) => { renderProdutosTable(e.target.value.trim()); });

function exportarBackupCompletoSistema() {
    const backup = { versao: "3.0", produtos: produtosDB, vendas: vendasDB, caixa: caixaStatus, empresa: empresaConfig };
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(backup, null, 2));
    const a = document.createElement('a');
    a.setAttribute("href", dataStr);
    a.setAttribute("download", `BACKUP_PDV_PRO.json`);
    document.body.appendChild(a); a.click(); a.remove();
}

function importarBackupCompletoSistema() {
    const fileInput = document.getElementById('backup-file-input');
    if (!fileInput.files || fileInput.files.length === 0) return alert("Selecione um arquivo .json!");
    const leitor = new FileReader();
    leitor.onload = function(e) {
        try {
            const dados = JSON.parse(e.target.result);
            if (dados.produtos && dados.vendas && dados.caixa) {
                if(confirm("Aviso: Esta operação apagará e substituirá os dados atuais! Prosseguir?")) {
                    localStorage.setItem('pdv_v3_produtos', JSON.stringify(dados.produtos));
                    localStorage.setItem('pdv_v3_vendas', JSON.stringify(dados.vendas));
                    localStorage.setItem('pdv_v3_caixa_status', JSON.stringify(dados.caixa));
                    if(dados.empresa) localStorage.setItem('pdv_v3_empresa', JSON.stringify(dados.empresa));
                    window.location.reload();
                }
            } else { alert("Arquivo de backup inválido."); }
        } catch(err) { alert("Erro ao processar arquivo: " + err.message); }
    };
    leitor.readAsText(fileInput.files[0]);
}

function renderHistoricoGeralVendas() {
    const tbody = document.getElementById('sales-history-tbody');
    if (vendasDB.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 20px;">Nenhuma venda registrada.</td></tr>';
        return;
    }
    tbody.innerHTML = '';
    vendasDB.forEach(v => {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td><strong>${v.id}</strong></td><td>${v.timestamp}</td><td><kbd>${v.metodo}</kbd></td><td>${v.volumes} un</td><td class="text-success" style="font-weight:bold;">${formatarMoeda(v.total)}</td><td style="text-align: center;"><button class="row-action-btn" style="color: var(--sotaque)" onclick="reimprimirCupomAntigoHistorico('${v.id}')"><i class="fa-solid fa-print"></i> Recompor</button></td>`;
        tbody.appendChild(tr);
    });
}

function limparHistoricoGeralVendasTotalmente() {
    if(confirm("Limpar permanentemente todo o histórico de vendas gravadas?")) {
        vendasDB = []; localStorage.setItem('pdv_v3_vendas', JSON.stringify(vendasDB)); renderHistoricoGeralVendas();
    }
}

function configurarNavegacaoAbas() {
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
            if(btn.dataset.tab === 'caixa' && caixaStatus.estado === 'aberto' && modoEntradaAtivo === 'barcode') barcodeInput.focus();
        });
    });
}

function configurarTemaEscuro() {
    const toggle = document.getElementById('theme-toggle');
    if (localStorage.getItem('pdv_v3_dark') === 'true') { document.body.classList.add('dark-mode'); toggle.innerHTML = '<i class="fa-solid fa-sun"></i>'; }
    toggle.addEventListener('click', () => {
        document.body.classList.toggle('dark-mode');
        const isDark = document.body.classList.contains('dark-mode');
        localStorage.setItem('pdv_v3_dark', isDark);
        toggle.innerHTML = isDark ? '<i class="fa-solid fa-sun"></i>' : '<i class="fa-solid fa-moon"></i>';
    });
}

function mapearAtalhosTecladoGlobais() {
    window.addEventListener('keydown', (e) => {
        if(caixaStatus.estado !== 'aberto') return;
        if (e.key === 'F2') { e.preventDefault(); setModoEntrada('manual'); }
        if (e.key === 'F3') { e.preventDefault(); setModoEntrada('barcode'); }
        if (e.key === 'F4') { e.preventDefault(); if(document.getElementById('payment-modal').classList.contains('active')) processarEfetivacaoVendaFinal(); else abrirModalPagamento(); }
        if (e.key === 'F7') { e.preventDefault(); definirMultiplicadorQuantidade(); }
        if (e.key === 'Escape') { e.preventDefault(); if(document.getElementById('payment-modal').classList.contains('active')) fecharModalPagamento(); else limparVendaAtiva(); }
        if (e.key === 'Delete') { if(document.activeElement.tagName !== 'INPUT') removerUltimoItem(); }
    });
}

function formatarMoeda(v) { return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }
