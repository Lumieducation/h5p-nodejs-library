import { ReadStream } from 'fs';
import fsExtra from 'fs-extra';
import path from 'path';
import promisepipe from 'promisepipe';

import {
    H5pError,
    ITemporaryFile,
    ITemporaryFileStorage,
    IUser
} from '../../../src';

/**
 * Stores temporary files in directories on the disk.
 * Manages access rights by creating one sub-directory for each user.
 * Manages expiration times by creating companion '.metadata' files for every
 * file stored.
 */
export default class DirectoryTemporaryFileStorage
    implements ITemporaryFileStorage {
    /**
     * @param directory the directory in which the temporary files are stored.
     * Must be read- and write accessible
     */
    constructor(private directory: string) {}

    public async deleteFile(filename: string, userId: string): Promise<void> {
        const filePath = this.getAbsoluteFilePath(userId, filename);
        await fsExtra.remove(filePath);
        await fsExtra.remove(`${filePath}.metadata`);

        const directoryPath = this.getAbsoluteUserDirectoryPath(userId);
        const userFiles = await fsExtra.readdir(directoryPath);
        if (userFiles.length === 0) {
            await fsExtra.rmdir(directoryPath);
        }
    }

    public async fileExists(filename: string, user: IUser): Promise<boolean> {
        const filePath = this.getAbsoluteFilePath(user.id, filename);
        return fsExtra.pathExists(filePath);
    }

    public async getFileStream(
        filename: string,
        user: IUser
    ): Promise<ReadStream> {
        const filePath = this.getAbsoluteFilePath(user.id, filename);
        if (!(await fsExtra.pathExists(filePath))) {
            throw new H5pError(
                `The file ${filename} is not accessible for user ${user.id} or does not exist.`
            );
        }
        return fsExtra.createReadStream(filePath);
    }

    public async listFiles(user?: IUser): Promise<ITemporaryFile[]> {
        const users = user ? [user.id] : await fsExtra.readdir(this.directory);
        return (
            await Promise.all(
                users.map(async u => {
                    const filesOfUser = await fsExtra.readdir(
                        this.getAbsoluteUserDirectoryPath(u)
                    );
                    return Promise.all(
                        filesOfUser
                            .filter(f => !f.endsWith('.metadata'))
                            .map(f => this.getTemporaryFileInfo(f, u))
                    );
                })
            )
        ).reduce((prev, curr) => prev.concat(curr), []);
    }

    public async saveFile(
        filename: string,
        dataStream: ReadStream,
        user: IUser,
        expirationTime: Date
    ): Promise<ITemporaryFile> {
        await fsExtra.ensureDir(this.getAbsoluteUserDirectoryPath(user.id));
        const filePath = this.getAbsoluteFilePath(user.id, filename);
        const writeStream = fsExtra.createWriteStream(filePath);
        await promisepipe(dataStream, writeStream);
        await fsExtra.writeJSON(`${filePath}.metadata`, {
            expiresAt: expirationTime.getTime()
        });
        return {
            expiresAt: expirationTime,
            filename,
            ownedByUserId: user.id
        };
    }

    private getAbsoluteFilePath(userId: string, filename: string): string {
        return path.join(this.directory, userId, filename);
    }

    private getAbsoluteUserDirectoryPath(userId: string): string {
        return path.join(this.directory, userId);
    }

    private async getTemporaryFileInfo(
        filename: string,
        userId: string
    ): Promise<ITemporaryFile> {
        const metadata = await fsExtra.readJSON(
            `${this.getAbsoluteFilePath(userId, filename)}.metadata`
        );
        return {
            expiresAt: new Date(metadata.expiresAt),
            filename,
            ownedByUserId: userId
        };
    }
}