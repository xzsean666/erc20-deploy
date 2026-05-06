const TOKENS = [
  {
    id: "bsc-testnet-usdt-s",
    name: "USDT SEAN TEST",
    symbol: "USDT-S",
    decimals: 18,
    address: "0xBc5C09c67542fC33fB38fC164c1ACE94423e34f4",
    chainId: 97,
    chainName: "BSC Testnet",
    nativeCurrency: { name: "tBNB", symbol: "tBNB", decimals: 18 },
    explorer: "https://testnet.bscscan.com",
    rpcUrls: [
      "https://bsc-testnet-dataseed.bnbchain.org",
      "https://bsc-testnet.bnbchain.org",
      "https://bsc-prebsc-dataseed.bnbchain.org",
      "https://data-seed-prebsc-1-s1.bnbchain.org:8545",
    ],
  },
  {
    id: "polygon-amoy-usdt-s",
    name: "USDT SEAN TEST",
    symbol: "USDT-S",
    decimals: 18,
    address: "0xebe1AF878AdC36994cebE5f8fd3BF772661E3D14",
    chainId: 80002,
    chainName: "Polygon Amoy",
    nativeCurrency: { name: "POL", symbol: "POL", decimals: 18 },
    explorer: "https://amoy.polygonscan.com",
    rpcUrls: [
      "https://polygon-amoy.drpc.org",
      "https://rpc-amoy.polygon.technology",
    ],
  },
];

const SELECTED_TOKEN_STORAGE_KEY = "usdt-s-faucet-token";

const SELECTOR_MINT = "0x40c10f19";
const SELECTOR_BALANCE_OF = "0x70a08231";

const state = {
  account: "",
  chainId: "",
  selectedTokenId: readStoredTokenId(),
  busy: false,
};

const el = {
  pageEyebrow: document.querySelector("#pageEyebrow"),
  tokenSymbol: document.querySelector("#tokenSymbol"),
  tokenLink: document.querySelector("#tokenLink"),
  tokenSelect: document.querySelector("#tokenSelect"),
  walletText: document.querySelector("#walletText"),
  balanceText: document.querySelector("#balanceText"),
  networkPill: document.querySelector("#networkPill"),
  networkText: document.querySelector("#networkText"),
  recipientInput: document.querySelector("#recipientInput"),
  amountInput: document.querySelector("#amountInput"),
  amountSymbol: document.querySelector("#amountSymbol"),
  connectBtn: document.querySelector("#connectBtn"),
  switchBtn: document.querySelector("#switchBtn"),
  addTokenBtn: document.querySelector("#addTokenBtn"),
  mintBtn: document.querySelector("#mintBtn"),
  faucetForm: document.querySelector("#faucetForm"),
  statusLine: document.querySelector("#statusLine"),
  txLink: document.querySelector("#txLink"),
};

function readStoredTokenId() {
  try {
    const storedId = window.localStorage.getItem(SELECTED_TOKEN_STORAGE_KEY);
    if (TOKENS.some((token) => token.id === storedId)) {
      return storedId;
    }
  } catch {
    // Ignore storage errors in restricted browser contexts.
  }

  return TOKENS[0].id;
}

function persistSelectedTokenId() {
  try {
    window.localStorage.setItem(SELECTED_TOKEN_STORAGE_KEY, state.selectedTokenId);
  } catch {
    // Ignore storage errors in restricted browser contexts.
  }
}

function selectedToken() {
  return TOKENS.find((token) => token.id === state.selectedTokenId) || TOKENS[0];
}

function provider() {
  return window.ethereum;
}

function hasWallet() {
  return Boolean(provider() && provider().request);
}

function shortAddress(address) {
  if (!address) return "未连接";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function chainHex(token) {
  return `0x${token.chainId.toString(16)}`;
}

function isAddress(value) {
  return /^0x[a-fA-F0-9]{40}$/.test(value);
}

function setStatus(message, type = "") {
  el.statusLine.textContent = message;
  el.statusLine.className = `status-line ${type}`.trim();
}

function setBusy(value) {
  state.busy = value;
  el.mintBtn.disabled = value;
  el.connectBtn.disabled = value;
  el.switchBtn.disabled = value;
  el.addTokenBtn.disabled = value;
  el.tokenSelect.disabled = value;
}

function request(method, params = []) {
  if (!hasWallet()) {
    throw new Error("未检测到浏览器钱包");
  }
  return provider().request({ method, params });
}

function pad64(hex) {
  return hex.padStart(64, "0");
}

function encodeAddress(address) {
  return pad64(address.toLowerCase().replace(/^0x/, ""));
}

function encodeUint256(value) {
  return pad64(value.toString(16));
}

function encodeMint(recipient, amount) {
  return `${SELECTOR_MINT}${encodeAddress(recipient)}${encodeUint256(amount)}`;
}

function encodeBalanceOf(address) {
  return `${SELECTOR_BALANCE_OF}${encodeAddress(address)}`;
}

function parseUnits(value, decimals) {
  const normalized = value.trim();
  if (!/^\d+(\.\d+)?$/.test(normalized)) {
    throw new Error("请输入有效数量");
  }

  const [wholePart, fractionPart = ""] = normalized.split(".");
  if (fractionPart.length > decimals) {
    throw new Error(`小数位不能超过 ${decimals}`);
  }

  const base = 10n ** BigInt(decimals);
  const whole = BigInt(wholePart || "0") * base;
  const fractionText = fractionPart.padEnd(decimals, "0") || "0";
  const fraction = decimals === 0 ? 0n : BigInt(fractionText);
  const amount = whole + fraction;

  if (amount <= 0n) {
    throw new Error("数量必须大于 0");
  }

  return amount;
}

function formatUnits(value, decimals) {
  const base = 10n ** BigInt(decimals);
  const whole = value / base;
  const fraction = value % base;

  if (fraction === 0n || decimals === 0) {
    return whole.toString();
  }

  const fractionText = fraction
    .toString()
    .padStart(decimals, "0")
    .replace(/0+$/, "")
    .slice(0, 6);

  return `${whole}.${fractionText}`;
}

function txUrl(hash) {
  const token = selectedToken();
  return `${token.explorer}/tx/${hash}`;
}

function tokenUrl() {
  const token = selectedToken();
  return `${token.explorer}/token/${token.address}`;
}

function updateNetworkUi() {
  const token = selectedToken();

  el.networkPill.classList.remove("ready", "wrong");

  if (!state.chainId) {
    el.networkText.textContent = "未连接";
    return;
  }

  if (state.chainId.toLowerCase() === chainHex(token)) {
    el.networkPill.classList.add("ready");
    el.networkText.textContent = token.chainName;
    return;
  }

  el.networkPill.classList.add("wrong");
  el.networkText.textContent = `当前链 ${Number.parseInt(state.chainId, 16)}`;
}

function updateWalletUi() {
  el.walletText.textContent = shortAddress(state.account);
  el.connectBtn.textContent = state.account ? shortAddress(state.account) : "连接钱包";
}

function updateTokenOptions() {
  const options = TOKENS.map((token) => {
    const option = document.createElement("option");
    option.value = token.id;
    option.textContent = `${token.chainName} · ${token.symbol}`;
    return option;
  });

  el.tokenSelect.replaceChildren(...options);
  el.tokenSelect.value = selectedToken().id;
}

function updateStaticUi() {
  const token = selectedToken();

  document.title = `${token.symbol} Faucet`;
  el.pageEyebrow.textContent = token.chainName;
  el.tokenSymbol.textContent = token.symbol;
  el.amountSymbol.textContent = token.symbol;
  el.tokenLink.href = tokenUrl();
  el.tokenLink.textContent = shortAddress(token.address);
  el.tokenLink.title = token.address;
  el.switchBtn.textContent = `切换到 ${token.chainName}`;
  el.addTokenBtn.textContent = `添加 ${token.symbol}`;
}

async function refreshChain() {
  if (!hasWallet()) {
    state.chainId = "";
    updateNetworkUi();
    return;
  }

  state.chainId = await request("eth_chainId");
  updateNetworkUi();
}

async function refreshBalance() {
  const token = selectedToken();
  const tokenId = token.id;
  const target = el.recipientInput.value.trim() || state.account;

  if (
    !hasWallet() ||
    !isAddress(target) ||
    state.chainId.toLowerCase() !== chainHex(token)
  ) {
    el.balanceText.textContent = "--";
    return;
  }

  try {
    const data = encodeBalanceOf(target);
    const result = await request("eth_call", [{ to: token.address, data }, "latest"]);
    const balance = BigInt(result);
    if (selectedToken().id === tokenId) {
      el.balanceText.textContent = `${formatUnits(balance, token.decimals)} ${token.symbol}`;
    }
  } catch {
    el.balanceText.textContent = "--";
  }
}

async function connectWallet() {
  const accounts = await request("eth_requestAccounts");
  state.account = accounts[0] || "";
  if (state.account && !el.recipientInput.value.trim()) {
    el.recipientInput.value = state.account;
  }
  updateWalletUi();
  await refreshChain();
  await refreshBalance();
}

async function ensureChain() {
  const token = selectedToken();

  await refreshChain();

  if (state.chainId.toLowerCase() === chainHex(token)) {
    return;
  }

  try {
    await request("wallet_switchEthereumChain", [{ chainId: chainHex(token) }]);
  } catch (error) {
    if (error && Number(error.code) === 4902) {
      await addChainWithRpcFallback(token);
      await request("wallet_switchEthereumChain", [{ chainId: chainHex(token) }]);
    } else {
      throw error;
    }
  }

  await refreshChain();
}

async function addChainWithRpcFallback(token) {
  let lastError;

  for (const rpcUrl of token.rpcUrls) {
    try {
      await request("wallet_addEthereumChain", [
        {
          chainId: chainHex(token),
          chainName: token.chainName,
          nativeCurrency: token.nativeCurrency,
          rpcUrls: [rpcUrl],
          blockExplorerUrls: [token.explorer],
        },
      ]);
      return;
    } catch (error) {
      lastError = error;

      if (error && Number(error.code) === 4001) {
        throw error;
      }
    }
  }

  throw lastError || new Error(`${token.chainName} RPC 无法连接`);
}

function normalizeError(error) {
  const token = selectedToken();

  if (error && error.code === 4001) {
    return "钱包已取消";
  }

  const message = error && (error.shortMessage || error.reason || error.message);
  if (!message) {
    return "操作失败";
  }

  if (/user rejected|denied transaction|rejected/i.test(message)) {
    return "钱包已取消";
  }

  if (/could not fetch chain id|chain id|rpc url|failed to fetch/i.test(message)) {
    return `MetaMask 无法连接 ${token.chainName} RPC，请换网络环境或手动添加 ${token.chainName}`;
  }

  if (/insufficient funds|intrinsic gas too low|gas required exceeds/i.test(message)) {
    return `钱包里的 ${token.nativeCurrency.symbol} 不够，${token.chainName} mint 也需要 ${token.nativeCurrency.symbol} 付 gas`;
  }

  return message;
}

async function waitForReceipt(hash) {
  for (let i = 0; i < 60; i += 1) {
    const receipt = await request("eth_getTransactionReceipt", [hash]);
    if (receipt) {
      if (receipt.status === "0x1") {
        return receipt;
      }
      throw new Error("交易执行失败");
    }
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }

  throw new Error("交易已提交，确认仍在进行中");
}

async function mint(event) {
  event.preventDefault();

  try {
    const token = selectedToken();

    setBusy(true);
    el.txLink.hidden = true;

    if (!state.account) {
      await connectWallet();
    }

    await ensureChain();

    const recipient = el.recipientInput.value.trim();
    if (!isAddress(recipient)) {
      throw new Error("请输入有效接收地址");
    }

    const amount = parseUnits(el.amountInput.value, token.decimals);
    const data = encodeMint(recipient, amount);

    setStatus("等待钱包确认", "pending");
    const hash = await request("eth_sendTransaction", [
      {
        from: state.account,
        to: token.address,
        data,
        value: "0x0",
      },
    ]);

    el.txLink.href = txUrl(hash);
    el.txLink.hidden = false;
    setStatus("交易已提交，等待确认", "pending");

    await waitForReceipt(hash);
    setStatus("Mint 成功", "success");
    await refreshBalance();
  } catch (error) {
    setStatus(normalizeError(error), "error");
  } finally {
    setBusy(false);
  }
}

async function addTokenToWallet() {
  try {
    const token = selectedToken();

    setBusy(true);
    el.txLink.hidden = true;

    if (!state.account) {
      await connectWallet();
    }

    await ensureChain();

    setStatus("等待钱包确认添加 Token", "pending");
    const added = await request("wallet_watchAsset", {
      type: "ERC20",
      options: {
        address: token.address,
        symbol: token.symbol,
        decimals: token.decimals,
      },
    });

    if (added) {
      setStatus(`${token.chainName} ${token.symbol} 已添加到钱包`, "success");
    } else {
      setStatus("钱包未添加 Token", "error");
    }
  } catch (error) {
    setStatus(normalizeError(error), "error");
  } finally {
    setBusy(false);
  }
}

function registerWalletEvents() {
  if (!hasWallet() || typeof provider().on !== "function") return;

  provider().on("accountsChanged", async (accounts) => {
    state.account = accounts[0] || "";
    if (state.account) {
      el.recipientInput.value = state.account;
    }
    updateWalletUi();
    await refreshBalance();
  });

  provider().on("chainChanged", async (chainId) => {
    state.chainId = chainId;
    updateNetworkUi();
    await refreshBalance();
  });
}

async function hydrateWalletState() {
  if (!hasWallet()) {
    return;
  }

  try {
    const accounts = await request("eth_accounts");
    state.account = accounts[0] || "";
    if (state.account && !el.recipientInput.value.trim()) {
      el.recipientInput.value = state.account;
    }
    updateWalletUi();
    await refreshChain();
    await refreshBalance();
  } catch {
    // Ignore passive hydration failures; explicit button actions report errors.
  }
}

function init() {
  updateTokenOptions();
  updateStaticUi();
  updateWalletUi();
  updateNetworkUi();
  registerWalletEvents();
  void hydrateWalletState();

  el.connectBtn.addEventListener("click", async () => {
    try {
      setBusy(true);
      await connectWallet();
      setStatus("钱包已连接", "success");
    } catch (error) {
      setStatus(normalizeError(error), "error");
    } finally {
      setBusy(false);
    }
  });

  el.switchBtn.addEventListener("click", async () => {
    try {
      setBusy(true);
      await ensureChain();
      await refreshBalance();
      setStatus("网络已切换", "success");
    } catch (error) {
      setStatus(normalizeError(error), "error");
    } finally {
      setBusy(false);
    }
  });

  el.addTokenBtn.addEventListener("click", addTokenToWallet);

  el.tokenSelect.addEventListener("change", async () => {
    state.selectedTokenId = el.tokenSelect.value;
    persistSelectedTokenId();
    el.txLink.hidden = true;
    updateStaticUi();
    updateNetworkUi();
    await refreshBalance();
    const token = selectedToken();
    setStatus(`已选择 ${token.chainName} ${token.symbol}`, "");
  });

  el.recipientInput.addEventListener("input", () => {
    window.clearTimeout(el.recipientInput.refreshTimer);
    el.recipientInput.refreshTimer = window.setTimeout(refreshBalance, 350);
  });

  el.faucetForm.addEventListener("submit", mint);

  if (!hasWallet()) {
    setStatus("未检测到浏览器钱包", "error");
  }
}

init();
