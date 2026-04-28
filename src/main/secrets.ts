import { safeStorage } from 'electron';

export class SecretVault {
    encrypt(value: string): string {
        if (!safeStorage.isEncryptionAvailable()) {
            throw new Error('OS-backed secret encryption is not available on this system.');
        }
        return safeStorage.encryptString(value).toString('base64');
    }

    decrypt(encryptedValue: string): string {
        if (!safeStorage.isEncryptionAvailable()) {
            throw new Error('OS-backed secret encryption is not available on this system.');
        }
        return safeStorage.decryptString(Buffer.from(encryptedValue, 'base64'));
    }
}

export const vault = new SecretVault();
