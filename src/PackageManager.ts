import { WriteStream } from 'fs';
import fsExtra from 'fs-extra';
import path from 'path';
import promisepipe from 'promisepipe';
import { Readable } from 'stream';
import { dir } from 'tmp-promise';
import yauzlPromise from 'yauzl-promise';
import yazl from 'yazl';

import ContentManager from './ContentManager';
import EditorConfig from './EditorConfig';
import H5pError from './helpers/H5pError';
import ValidationError from './helpers/ValidationError';
import LibraryManager from './LibraryManager';
import PackageValidator from './PackageValidator';
import {
    ContentId,
    ITranslationService,
    IUser,
    Permission,
    IH5PJson
} from './types';
import DependencyGetter from './DependencyGetter';
import Library from './Library';

/**
 * Handles the installation of libraries and saving of content from a H5P package.
 */
export default class PackageManager {
    /**
     * @param {LibraryManager} libraryManager
     * @param {TranslationService} translationService
     * @param {EditorConfig} config
     * @param {ContentManager} contentManager (optional) Only needed if you want to use the PackageManger to copy content from a package (e.g. Upload option in the editor)
     */
    constructor(
        private libraryManager: LibraryManager,
        private translationService: ITranslationService,
        private config: EditorConfig,
        private contentManager: ContentManager = null
    ) {}

    /**
     * Extracts a H5P package to the specified directory.
     * @param {string} packagePath The full path to the H5P package file on the local disk
     * @param {string} directoryPath The full path of the directory to which the package should be extracted
     * @param {boolean} includeLibraries If true, the library directories inside the package will be extracted.
     * @param {boolean} includeContent If true, the content folder inside the package will be extracted.
     * @param {boolean} includeMetadata If true, the h5p.json file inside the package will be extracted.
     * @returns {Promise<void>}
     */
    private static async extractPackage(
        packagePath: string,
        directoryPath: string,
        {
            includeLibraries = false,
            includeContent = false,
            includeMetadata = false
        }: {
            includeContent: boolean;
            includeLibraries: boolean;
            includeMetadata: boolean;
        }
    ): Promise<void> {
        const zipFile = await yauzlPromise.open(packagePath);
        await zipFile.walkEntries(async (entry: any) => {
            const basename = path.basename(entry.fileName);
            if (
                !basename.startsWith('.') &&
                !basename.startsWith('_') &&
                ((includeContent && entry.fileName.startsWith('content/')) ||
                    (includeLibraries &&
                        entry.fileName.includes('/') &&
                        !entry.fileName.startsWith('content/')) ||
                    (includeMetadata && entry.fileName === 'h5p.json'))
            ) {
                const readStream = await entry.openReadStream();
                const writePath = path.join(directoryPath, entry.fileName);

                await fsExtra.mkdirp(path.dirname(writePath));
                const writeStream = fsExtra.createWriteStream(writePath);
                await promisepipe(readStream, writeStream);
            }
        });
    }

    /**
     * Adds content from a H5P package to the system (e.g. when uploading a H5P file). Also installs the necessary libraries from the package if they are not already installed.
     * Throws errors if something goes wrong.
     * @param {string} packagePath The full path to the H5P package file on the local disk.
     * @param {User} user The user who wants to upload the package.
     * @param {number} contentId (optional) the content id to use for the package
     * @returns {Promise<number>} the id of the newly created content
     */
    public async addPackageLibrariesAndContent(
        packagePath: string,
        user: IUser,
        contentId?: ContentId
    ): Promise<ContentId> {
        return this.processPackage(
            packagePath,
            {
                copyContent: true,
                installLibraries: user.canUpdateAndInstallLibraries
            },
            user,
            contentId
        );
    }

    /**
     * Creates a .h5p-package for the specified content file and pipes it to the stream.
     * Throws H5pErrors if something goes wrong. The contents of the stream should be disregarded then.
     * @param contentId The contentId for which the package should be created.
     * @param outputStream The stream that the package is written to (e.g. the response stream fo Express)
     */
    public async createPackage(
        contentId: ContentId,
        outputStream: WriteStream,
        user: IUser
    ): Promise<void> {
        if (!(await this.contentManager.contentExists(contentId))) {
            throw new H5pError(
                `Content can't be downloaded as no content with id ${contentId} exists.`
            );
        }
        if (
            !(await this.contentManager.getUserPermissions(
                contentId,
                user
            )).some(p => p === Permission.Download)
        ) {
            throw new H5pError(
                `You do not have permission to download content with id ${contentId}`
            );
        }
        let contentStream: Readable;
        try {
            const content = await this.contentManager.loadContent(
                contentId,
                user
            );
            contentStream = new Readable();
            contentStream._read = () => {
                return;
            };
            contentStream.push(JSON.stringify(content));
            contentStream.push(null);
        } catch (error) {
            throw new H5pError(
                `Content can't be downloaded as the content data is unreadable.`
            );
        }
        let metadataStream: Readable;
        let metadata: IH5PJson;
        try {
            metadata = await this.contentManager.loadH5PJson(contentId, user);
            metadataStream = new Readable();
            metadataStream._read = () => {
                return;
            };
            metadataStream.push(JSON.stringify(metadata));
            metadataStream.push(null);
        } catch (error) {
            throw new H5pError(
                `Content can't be downloaded as the content metadata is unreadable.`
            );
        }

        const contentFiles = await this.contentManager.getContentFiles(
            contentId,
            user
        );
        const zip = new yazl.ZipFile();
        zip.outputStream.pipe(outputStream);
        zip.addReadStream(metadataStream, 'h5p.json');
        zip.addReadStream(contentStream, 'content/content.json');
        for (const contentFile of contentFiles) {
            const filePath = path.join('content', contentFile);
            zip.addReadStream(
                this.contentManager.getContentFileStream(
                    contentId,
                    filePath,
                    user
                ),
                filePath
            );
        }

        const dependencyGetter = new DependencyGetter(this.libraryManager);
        const mainLibrary = metadata.preloadedDependencies.find(
            l => l.machineName === metadata.mainLibrary
        );
        if (!mainLibrary) {
            throw new H5pError(
                `The main library ${metadata.mainLibrary} is not listed in the dependencies`
            );
        }
        const dependencies = await dependencyGetter.getDependencies(
            new Library(
                mainLibrary.machineName,
                mainLibrary.majorVersion,
                mainLibrary.minorVersion
            ),
            { editor: true, preloaded: true }
        );
        for (const dependency of dependencies) {
            const files = await this.libraryManager.listFiles(dependency);
            for (const file of files) {
                zip.addReadStream(
                    this.libraryManager.getFileStream(dependency, file),
                    `${dependency.getDirName()}/${file}`
                );
            }
        }

        zip.end();
    }

    /**
     * Installs all libraries from the package. Assumes that the user calling this has the permission to install libraries!
     * Throws errors if something goes wrong.
     * @param {string} packagePath The full path to the H5P package file on the local disk.
     * @returns {Promise<void>}
     */
    public async installLibrariesFromPackage(
        packagePath: string
    ): Promise<ContentId> {
        return this.processPackage(packagePath, {
            copyContent: false,
            installLibraries: true
        });
    }

    /**
     * Generic method to process a H5P package. Can install libraries and copy content.
     * @param {string} packagePath The full path to the H5P package file on the local disk
     * @param {boolean} installLibraries If true, try installing libraries from package. Defaults to false.
     * @param {boolean} copyContent If true, try copying content from package. Defaults to false.
     * @param {User} user (optional) the user who wants to copy content (only needed when copying content)
     * @returns {Promise<number|undefined>} The id of the newly created content when content was copied or undefined otherwise.
     */
    private async processPackage(
        packagePath: string,
        {
            installLibraries = false,
            copyContent = false
        }: { copyContent: boolean; installLibraries: boolean },
        user?: IUser,
        contentId?: ContentId
    ): Promise<ContentId> {
        const packageValidator = new PackageValidator(
            this.translationService,
            this.config
        );
        let newContentId: ContentId;
        try {
            await packageValidator.validatePackage(packagePath, false, true); // no need to check result as the validator throws an exception if there is an error
            const { path: tempDirPath } = await dir(); // we don't use withDir here, to have better error handling (catch block below)
            try {
                await PackageManager.extractPackage(packagePath, tempDirPath, {
                    includeContent: copyContent,
                    includeLibraries: installLibraries,
                    includeMetadata: copyContent
                });
                const dirContent = await fsExtra.readdir(tempDirPath);

                // install all libraries
                if (installLibraries) {
                    await Promise.all(
                        dirContent
                            .filter(
                                (dirEntry: string) =>
                                    dirEntry !== 'h5p.json' &&
                                    dirEntry !== 'content'
                            )
                            .map((dirEntry: string) =>
                                this.libraryManager.installFromDirectory(
                                    path.join(tempDirPath, dirEntry),
                                    false
                                )
                            )
                    );
                }

                // Copy content to the repository
                if (copyContent) {
                    if (!this.contentManager) {
                        throw new Error(
                            'PackageManager was initialized with a ContentManager, but you want to copy content from a package. Pass a ContentManager object to the the constructor!'
                        );
                    }
                    newContentId = await this.contentManager.copyContentFromDirectory(
                        tempDirPath,
                        user,
                        contentId
                    );
                }
            } catch (error) {
                // otherwise finally swallows errors
                throw error;
            } finally {
                // clean up temporary files in any case
                await fsExtra.remove(tempDirPath);
            }
        } catch (error) {
            if (error instanceof ValidationError) {
                throw new H5pError(error.message); // TODO: create AJAX response?
            } else {
                throw error;
            }
        }

        return newContentId;
    }
}

module.exports = PackageManager;
