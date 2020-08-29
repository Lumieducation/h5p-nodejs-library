import { Readable } from 'stream';
import { Cache } from 'cache-manager';

import {
    ILibraryStorage,
    ILibraryName,
    ILibraryMetadata,
    IInstalledLibrary,
    IFileStats,
    IAdditionalLibraryMetadata
} from '../../types';
import LibraryName from '../../LibraryName';

export default class CachedLibraryStorage implements ILibraryStorage {
    constructor(protected storage: ILibraryStorage, protected cache: Cache) {}

    private readonly ADDONS_CACHE_KEY: string = 'addons';
    private readonly FILE_EXISTS_CACHE_KEY: string = 'exists';
    private readonly INSTALLED_LIBRARY_NAMES_CACHE_KEY: string =
        'installed-library-names';
    private readonly JSON_CACHE_KEY: string = 'json';
    private readonly LANGUAGES_CACHE_KEY: string = 'languages';
    private readonly LIBRARY_IS_INSTALLED_CACHE_KEY: string = 'is-installed';
    private readonly METADATA_CACHE_KEY: string = 'metadata';
    private readonly STRING_CACHE_KEY: string = 'string';

    public async addFile(
        library: ILibraryName,
        filename: string,
        readStream: Readable
    ): Promise<boolean> {
        const result = await this.storage.addFile(
            library,
            filename,
            readStream
        );
        await this.deleteFileCache(library, filename);
        return result;
    }

    public async addLibrary(
        libraryData: ILibraryMetadata,
        restricted: boolean
    ): Promise<IInstalledLibrary> {
        const result = this.storage.addLibrary(libraryData, restricted);
        await this.cache.del(this.INSTALLED_LIBRARY_NAMES_CACHE_KEY);
        await this.cache.del(this.ADDONS_CACHE_KEY);
        await this.cache.del(
            this.getCacheKeyForMetadata(
                libraryData,
                this.LIBRARY_IS_INSTALLED_CACHE_KEY
            )
        );
        await this.cache.del(
            this.getCacheKeyForLibraryListByMachineName(libraryData.machineName)
        );
        return result;
    }

    /**
     * Invalidates the whole cache.
     */
    public async clearCache(): Promise<void> {
        return this.cache.reset();
    }

    public async clearFiles(library: ILibraryName): Promise<void> {
        const files = await this.storage.listFiles(library);
        await this.storage.clearFiles(library);
        await Promise.all(
            files.map((file) => this.deleteFileCache(library, file))
        );
    }

    public async deleteLibrary(library: ILibraryName): Promise<void> {
        const files = await this.storage.listFiles(library);
        await this.storage.deleteLibrary(library);
        await Promise.all(
            files
                .map((file) => this.deleteFileCache(library, file))
                .concat([
                    this.cache.del(
                        this.getCacheKeyForMetadata(
                            library,
                            this.METADATA_CACHE_KEY
                        )
                    ),
                    this.cache.del(
                        this.getCacheKeyForMetadata(
                            library,
                            this.LANGUAGES_CACHE_KEY
                        )
                    ),
                    this.cache.del(
                        this.getCacheKeyForMetadata(
                            library,
                            this.LIBRARY_IS_INSTALLED_CACHE_KEY
                        )
                    ),
                    this.cache.del(this.INSTALLED_LIBRARY_NAMES_CACHE_KEY),
                    this.cache.del(
                        this.getCacheKeyForLibraryListByMachineName(
                            library.machineName
                        )
                    ),
                    this.cache.del(this.ADDONS_CACHE_KEY)
                ])
        );
    }

    public async fileExists(
        library: ILibraryName,
        filename: string
    ): Promise<boolean> {
        return this.cache.wrap(
            this.getCacheKeyForFile(
                library,
                filename,
                this.FILE_EXISTS_CACHE_KEY
            ),
            () => {
                return this.storage.fileExists(library, filename);
            }
        );

        return this.storage.fileExists(library, filename);
    }

    /**
     * Not cached as the function will be called only very rarely.
     */
    public async getAllDependentsCount(): Promise<{
        [ubername: string]: number;
    }> {
        return this.storage.getAllDependentsCount();
    }

    /**
     * Not cached as the function will be called only very rarely.
     */
    public async getDependentsCount(library: ILibraryName): Promise<number> {
        return this.storage.getDependentsCount(library);
    }

    public async getFileAsJson(
        library: ILibraryName,
        file: string
    ): Promise<any> {
        return this.cache.wrap(
            this.getCacheKeyForFile(library, file, this.JSON_CACHE_KEY),
            () => {
                return this.storage.getFileAsJson(library, file);
            }
        );

        return this.storage.getFileAsJson(library, file);
    }

    public async getFileAsString(
        library: ILibraryName,
        file: string
    ): Promise<string> {
        return this.cache.wrap(
            this.getCacheKeyForFile(library, file, this.STRING_CACHE_KEY),
            () => {
                return this.storage.getFileAsString(library, file);
            }
        );

        return this.storage.getFileAsString(library, file);
    }

    public async getFileStats(
        library: ILibraryName,
        file: string
    ): Promise<IFileStats> {
        return this.storage.getFileStats(library, file);
    }

    public async getFileStream(
        library: ILibraryName,
        file: string
    ): Promise<Readable> {
        return this.storage.getFileStream(library, file);
    }

    public async getInstalledLibraryNames(
        machineName?: string
    ): Promise<ILibraryName[]> {
        if (machineName) {
            return this.cache.wrap(
                this.getCacheKeyForLibraryListByMachineName(machineName),
                () => {
                    return this.storage.getInstalledLibraryNames(machineName);
                }
            );
        }

        return this.cache.wrap(this.INSTALLED_LIBRARY_NAMES_CACHE_KEY, () => {
            return this.storage.getInstalledLibraryNames();
        });
    }

    public async getLanguages(library: ILibraryName): Promise<string[]> {
        return this.cache.wrap(
            this.getCacheKeyForMetadata(library, this.LANGUAGES_CACHE_KEY),
            () => {
                return this.storage.getLanguages(library);
            }
        );
    }

    public async getLibrary(library: ILibraryName): Promise<IInstalledLibrary> {
        return this.cache.wrap(
            this.getCacheKeyForMetadata(library, this.METADATA_CACHE_KEY),
            () => {
                return this.storage.getLibrary(library);
            }
        );
    }

    public async isInstalled(library: ILibraryName): Promise<boolean> {
        return this.cache.wrap(
            this.getCacheKeyForMetadata(
                library,
                this.LIBRARY_IS_INSTALLED_CACHE_KEY
            ),
            () => {
                return this.storage.isInstalled(library);
            }
        );
    }

    public async listAddons?(): Promise<ILibraryMetadata[]> {
        if (this.storage.listAddons) {
            return this.cache.wrap(this.ADDONS_CACHE_KEY, () => {
                return this.storage.listAddons();
            });
        }
        return [];
    }

    public async listFiles(library: ILibraryName): Promise<string[]> {
        return this.storage.listFiles(library);
    }

    public async updateAdditionalMetadata(
        library: ILibraryName,
        additionalMetadata: Partial<IAdditionalLibraryMetadata>
    ): Promise<boolean> {
        const result = await this.storage.updateAdditionalMetadata(
            library,
            additionalMetadata
        );
        await this.cache.del(
            this.getCacheKeyForMetadata(library, this.METADATA_CACHE_KEY)
        );
        return result;
    }

    public async updateLibrary(
        libraryMetadata: ILibraryMetadata
    ): Promise<IInstalledLibrary> {
        const result = await this.storage.updateLibrary(libraryMetadata);
        await this.cache.del(
            this.getCacheKeyForMetadata(
                libraryMetadata,
                this.METADATA_CACHE_KEY
            )
        );
        await this.cache.del(this.INSTALLED_LIBRARY_NAMES_CACHE_KEY);
        await this.cache.del(this.ADDONS_CACHE_KEY);
        await this.cache.del(
            this.getCacheKeyForLibraryListByMachineName(
                libraryMetadata.machineName
            )
        );
        return result;
    }

    private async deleteFileCache(
        library: ILibraryName,
        filename: string
    ): Promise<void> {
        await Promise.all([
            this.cache.del(
                this.getCacheKeyForFile(library, filename, this.JSON_CACHE_KEY)
            ),
            this.cache.del(
                this.getCacheKeyForFile(
                    library,
                    filename,
                    this.STRING_CACHE_KEY
                )
            ),
            this.cache.del(
                this.getCacheKeyForFile(
                    library,
                    filename,
                    this.FILE_EXISTS_CACHE_KEY
                )
            )
        ]);
    }

    private getCacheKeyForFile(
        library: ILibraryName,
        filename: string,
        usage: string
    ): string {
        return `${LibraryName.toUberName(library)}/${filename}-${usage}`;
    }

    private getCacheKeyForLibraryListByMachineName(
        machineName: string
    ): string {
        return `${this.INSTALLED_LIBRARY_NAMES_CACHE_KEY}-${machineName}`;
    }

    private getCacheKeyForMetadata(
        library: ILibraryName,
        usage: string
    ): string {
        return `${LibraryName.toUberName(library)}-${usage}`;
    }
}
