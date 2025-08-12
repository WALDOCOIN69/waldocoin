// 🔗 XRPL WALLET OPERATIONS

import xrpl from 'xrpl';
import { validateWalletAddress } from '../../../shared/utils/validation.js';
import { SUPPORTED_CHAINS, ERROR_CODES } from '../../../shared/types/index.js';

export class XRPLWallet {
  constructor(config) {
    this.client = new xrpl.Client(config.nodeUrl);
    this.distributorSecret = config.distributorSecret;
    this.distributorWallet = null;
    this.connected = false;
  }

  /**
   * Connect to XRPL network
   */
  async connect() {
    try {
      if (!this.connected) {
        await this.client.connect();
        this.connected = true;
        console.log('✅ Connected to XRPL network');
      }

      if (this.distributorSecret && !this.distributorWallet) {
        this.distributorWallet = xrpl.Wallet.fromSeed(this.distributorSecret);
        console.log(`🔑 Distributor wallet loaded: ${this.distributorWallet.classicAddress}`);
      }

      return { success: true };
    } catch (error) {
      console.error('❌ XRPL connection failed:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Disconnect from XRPL network
   */
  async disconnect() {
    try {
      if (this.connected) {
        await this.client.disconnect();
        this.connected = false;
        console.log('🔌 Disconnected from XRPL network');
      }
      return { success: true };
    } catch (error) {
      console.error('❌ XRPL disconnection failed:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Validate XRPL wallet address
   */
  validateAddress(address) {
    return validateWalletAddress(address, SUPPORTED_CHAINS.XRPL);
  }

  /**
   * Get wallet balance (XRP and WALDO)
   */
  async getBalance(address) {
    try {
      const validation = this.validateAddress(address);
      if (!validation.valid) {
        return { success: false, error: validation.error };
      }

      await this.connect();

      // Get XRP balance
      const accountInfo = await this.client.request({
        command: 'account_info',
        account: address,
        ledger_index: 'validated'
      });

      const xrpBalance = xrpl.dropsToXrp(accountInfo.result.account_data.Balance);

      // Get WALDO balance
      let waldoBalance = 0;
      try {
        const accountLines = await this.client.request({
          command: 'account_lines',
          account: address,
          ledger_index: 'validated'
        });

        const waldoLine = accountLines.result.lines.find(line => 
          line.currency === 'WLO' || line.currency.toLowerCase() === 'wlo'
        );

        if (waldoLine) {
          waldoBalance = parseFloat(waldoLine.balance);
        }
      } catch (error) {
        console.warn('⚠️ Could not fetch WALDO balance:', error.message);
      }

      return {
        success: true,
        data: {
          address,
          xrp: parseFloat(xrpBalance),
          waldo: waldoBalance,
          chain: SUPPORTED_CHAINS.XRPL
        }
      };
    } catch (error) {
      console.error('❌ Failed to get XRPL balance:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Check if wallet has WALDO trustline
   */
  async hasTrustline(address, issuer) {
    try {
      const validation = this.validateAddress(address);
      if (!validation.valid) {
        return { success: false, error: validation.error };
      }

      await this.connect();

      const accountLines = await this.client.request({
        command: 'account_lines',
        account: address,
        ledger_index: 'validated'
      });

      const hasTrustline = accountLines.result.lines.some(line => 
        (line.currency === 'WLO' || line.currency.toLowerCase() === 'wlo') &&
        line.account === issuer
      );

      return {
        success: true,
        data: { hasTrustline, address, issuer }
      };
    } catch (error) {
      console.error('❌ Failed to check trustline:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Send WALDO tokens
   */
  async sendWaldo(toAddress, amount, issuer) {
    try {
      if (!this.distributorWallet) {
        return { success: false, error: 'Distributor wallet not configured' };
      }

      const validation = this.validateAddress(toAddress);
      if (!validation.valid) {
        return { success: false, error: validation.error };
      }

      await this.connect();

      const payment = {
        TransactionType: 'Payment',
        Account: this.distributorWallet.classicAddress,
        Destination: toAddress,
        Amount: {
          currency: 'WLO',
          value: amount.toString(),
          issuer: issuer
        }
      };

      const prepared = await this.client.autofill(payment);
      const signed = this.distributorWallet.sign(prepared);
      const result = await this.client.submitAndWait(signed.tx_blob);

      if (result.result.meta.TransactionResult === 'tesSUCCESS') {
        return {
          success: true,
          data: {
            hash: result.result.hash,
            amount: amount,
            to: toAddress,
            chain: SUPPORTED_CHAINS.XRPL
          }
        };
      } else {
        return {
          success: false,
          error: `Transaction failed: ${result.result.meta.TransactionResult}`
        };
      }
    } catch (error) {
      console.error('❌ Failed to send WALDO:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Monitor transactions for specific address
   */
  async getRecentTransactions(address, limit = 20) {
    try {
      const validation = this.validateAddress(address);
      if (!validation.valid) {
        return { success: false, error: validation.error };
      }

      await this.connect();

      const response = await this.client.request({
        command: 'account_tx',
        account: address,
        limit: limit,
        ledger_index_min: -1,
        ledger_index_max: -1
      });

      const transactions = response.result.transactions.map(tx => ({
        hash: tx.tx.hash,
        type: tx.tx.TransactionType,
        account: tx.tx.Account,
        destination: tx.tx.Destination,
        amount: tx.tx.Amount,
        date: tx.tx.date,
        ledgerIndex: tx.tx.ledger_index,
        success: tx.meta.TransactionResult === 'tesSUCCESS'
      }));

      return {
        success: true,
        data: {
          address,
          transactions,
          chain: SUPPORTED_CHAINS.XRPL
        }
      };
    } catch (error) {
      console.error('❌ Failed to get transactions:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Subscribe to account transactions
   */
  async subscribeToAccount(address, callback) {
    try {
      const validation = this.validateAddress(address);
      if (!validation.valid) {
        return { success: false, error: validation.error };
      }

      await this.connect();

      await this.client.request({
        command: 'subscribe',
        accounts: [address]
      });

      this.client.on('transaction', (tx) => {
        if (tx.transaction.Account === address || tx.transaction.Destination === address) {
          callback({
            hash: tx.transaction.hash,
            type: tx.transaction.TransactionType,
            account: tx.transaction.Account,
            destination: tx.transaction.Destination,
            amount: tx.transaction.Amount,
            success: tx.meta.TransactionResult === 'tesSUCCESS'
          });
        }
      });

      return { success: true };
    } catch (error) {
      console.error('❌ Failed to subscribe to account:', error);
      return { success: false, error: error.message };
    }
  }
}
