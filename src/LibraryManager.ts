import { ReadStream } from 'fs';
import fsExtra from 'fs-extra';
import globPromise from 'glob-promise';
import path from 'path';
import { Stream } from 'stream';

import { streamToString } from './helpers/StreamHelpers';

import InstalledLibrary from './InstalledLibrary';
import LibraryName from './LibraryName';
import {
    IInstalledLibrary,
    ILibraryMetadata,
    ILibraryName,
    ILibraryStorage,
    IPath,
    ISemanticsEntry
} from './types';

/**
 * This class manages library installations, enumerating installed libraries etc.
 * It is storage agnostic and can be re-used in all implementations/plugins.
 */

export default class LibraryManager {
    /**
     *
     * @param {FileLibraryStorage} libraryStorage The library repository that persists library somewhere.
     */
    constructor(libraryStorage: ILibraryStorage) {
        this.libraryStorage = libraryStorage;
    }

    private libraryStorage: ILibraryStorage;

    /**
     * Returns a readable stream of a library file's contents.
     * Throws an exception if the file does not exist.
     * @param {ILibraryName} library library
     * @param {string} filename the relative path inside the library
     * @returns {ReadStream} a readable stream of the file's contents
     */
    public getFileStream(library: ILibraryName, file: string): ReadStream {
        return this.libraryStorage.getFileStream(library, file);
    }

    /**
     * Get id to an existing installed library.
     * If version number is not specified, the newest version will be returned.
     * @param {ILibraryName} library Note that patch version is ignored.
     * @returns {Promise<number>} The id of the specified library or undefined (if not installed).
     */
    public async getId(library: ILibraryName): Promise<number> {
        return this.libraryStorage.getId(library);
    }

    /**
     * Get a list of the currently installed libraries.
     * @param {String[]?} machineNames (if supplied) only return results for the machines names in the list
     * @returns {Promise<any>} An object which has properties with the existing library machine names. The properties'
     * values are arrays of Library objects, which represent the different versions installed of this library.
     */
    public async getInstalled(machineNames?: string[]): Promise<any> {
        let libraries = await this.libraryStorage.getInstalled(...machineNames);
        libraries = (await Promise.all(
            libraries.map(async libName => {
                const installedLib = InstalledLibrary.fromName(libName);
                const info = await this.loadLibrary(libName);
                installedLib.patchVersion = info.patchVersion;
                installedLib.id = info.libraryId;
                installedLib.runnable = info.runnable;
                installedLib.title = info.title;
                return installedLib;
            })
        )).sort((lib1, lib2) => lib1.compare(lib2));

        const returnObject = {};
        for (const library of libraries) {
            if (!returnObject[library.machineName]) {
                returnObject[library.machineName] = [];
            }
            returnObject[library.machineName].push(library);
        }
        return returnObject;
    }

    /**
     * Installs or updates a library from a temporary directory.
     * It does not delete the library files in the temporary directory.
     * The method does NOT validate the library! It must be validated before calling this method!
     * Throws an error if something went wrong and deletes the files already installed.
     * @param {string} directory The path to the temporary directory that contains the library files (the root directory that includes library.json)
     * @returns {Promise<boolean>} true if successful, false if the library was not installed (without having encountered an error, e.g. because there already is a newer patch version installed)
     */
    public async installFromDirectory(
        directory: string,
        restricted: boolean = false
    ): Promise<boolean> {
        const newLibraryMetadata: ILibraryMetadata = await fsExtra.readJSON(
            `${directory}/library.json`
        );
        if (await this.getId(newLibraryMetadata)) {
            // Check if library is already installed.
            if (await this.isPatchedLibrary(newLibraryMetadata)) {
                // Update the library if it is only a patch of an existing library
                await this.updateLibrary(newLibraryMetadata, directory);
                return true;
            }
            // Skip installation of library if it has already been installed and the library is no patch for it.
            return false;
        }
        // Install the library if it hasn't been installed before (treat different major/minor versions the same as a new library)
        await this.installLibrary(directory, newLibraryMetadata, restricted);
        return true;
    }

    /**
     * Is the library a patched version of an existing library?
     * @param {ILibraryMetadata} library The library the check
     * @returns {Promise<boolean>} true if the library is a patched version of an existing library, false otherwise
     */
    public async isPatchedLibrary(library: ILibraryMetadata): Promise<boolean> {
        const wrappedLibraryInfos = await this.getInstalled([
            library.machineName
        ]);
        if (!wrappedLibraryInfos || !wrappedLibraryInfos[library.machineName]) {
            return false;
        }
        const libraryInfos = wrappedLibraryInfos[library.machineName];

        for (const lib of libraryInfos) {
            if (
                lib.majorVersion === library.majorVersion &&
                lib.minorVersion === library.minorVersion
            ) {
                if (lib.patchVersion < library.patchVersion) {
                    return true;
                }
                break;
            }
        }
        return false;
    }

    /**
     * Check if the library contains a file
     * @param {ILibraryName} library The library to check
     * @param {string} filename
     * @return {Promise<boolean>} true if file exists in library, false otherwise
     */
    public async libraryFileExists(
        library: ILibraryName,
        filename: string
    ): Promise<boolean> {
        return this.libraryStorage.fileExists(library, filename);
    }

    /**
     * Checks if the given library has a higher version than the highest installed version.
     * @param {ILibraryMetadata} library Library to compare against the highest locally installed version.
     * @returns {Promise<boolean>} true if the passed library contains a version that is higher than the highest installed version, false otherwise
     */
    public async libraryHasUpgrade(
        library: ILibraryMetadata
    ): Promise<boolean> {
        const wrappedLibraryInfos = await this.getInstalled([
            library.machineName
        ]);
        if (!wrappedLibraryInfos || !wrappedLibraryInfos[library.machineName]) {
            return false;
        }
        const allInstalledLibsOfMachineName = wrappedLibraryInfos[
            library.machineName
        ].sort((a: any, b: any) => a.compareVersions(b));
        const highestLocalLibVersion =
            allInstalledLibsOfMachineName[
                allInstalledLibsOfMachineName.length - 1
            ];
        if (highestLocalLibVersion.compareVersions(library) < 0) {
            return true;
        }
        return false;
    }

    /**
     * Gets a list of files that exist in the library.
     * @param library the library for which the files should be listed
     * @return the files in the library including language files
     */
    public async listFiles(library: ILibraryName): Promise<string[]> {
        return this.libraryStorage.listFiles(library);
    }

    /**
     * Gets a list of translations that exist for this library.
     * @param {ILibraryName} library
     * @returns {Promise<string[]>} the language codes for translations of this library
     */
    public async listLanguages(library: ILibraryName): Promise<string[]> {
        try {
            return await this.libraryStorage.getLanguageFiles(library);
        } catch (error) {
            return [];
        }
    }

    /**
     * Gets the language file for the specified language.
     * @param {ILibraryName} library
     * @param {string} language the language code
     * @returns {Promise<any>} the decoded JSON data in the language file
     */
    public async loadLanguage(
        library: ILibraryName,
        language: string
    ): Promise<any> {
        try {
            return await this.getJsonFile(
                library,
                path.join('language', `${language}.json`)
            );
        } catch (ignored) {
            return null;
        }
    }

    /**
     * Returns the information about the library that is contained in library.json.
     * @param {ILibraryName} library The library to get (machineName, majorVersion and minorVersion is enough)
     * @returns {Promise<ILibrary>} the decoded JSON data or undefined if library is not installed
     */
    public async loadLibrary(
        library: ILibraryName
    ): Promise<IInstalledLibrary> {
        try {
            const libraryMetadata = await this.getJsonFile(
                library,
                'library.json'
            );
            libraryMetadata.libraryId = await this.getId(library);
            return libraryMetadata;
        } catch (ignored) {
            return undefined;
        }
    }

    /**
     * Returns the content of semantics.json for the specified library.
     * @param {ILibraryName} library
     * @returns {Promise<any>} the content of semantics.json
     */
    public async loadSemantics(
        library: ILibraryName
    ): Promise<ISemanticsEntry[]> {
        return this.getJsonFile(library, 'semantics.json');
    }

    /**
     * Checks (as far as possible) if all necessary files are present for the library to run properly.
     * @param {ILibraryName} library The library to check
     * @returns {Promise<boolean>} true if the library is ok. Throws errors if not.
     */
    private async checkConsistency(library: ILibraryName): Promise<boolean> {
        if (!(await this.libraryStorage.getId(library))) {
            throw new Error(
                `Error in library ${LibraryName.toDirName(
                    library
                )}: not installed.`
            );
        }

        let metadata: ILibraryMetadata;
        try {
            metadata = await this.getJsonFile(library, 'library.json');
        } catch (error) {
            throw new Error(
                `Error in library ${LibraryName.toDirName(
                    library
                )}: library.json not readable: ${error.message}.`
            );
        }
        if (metadata.preloadedJs) {
            await this.checkFiles(
                library,
                metadata.preloadedJs.map((js: IPath) => js.path)
            );
        }
        if (metadata.preloadedCss) {
            await this.checkFiles(
                library,
                metadata.preloadedCss.map((css: IPath) => css.path)
            );
        }

        return true;
    }

    /**
     * Checks if all files in the list are present in the library.
     * @param {ILibraryName} library The library to check
     * @param {string[]} requiredFiles The files (relative paths in the library) that must be present
     * @returns {Promise<boolean>} true if all dependencies are present. Throws an error if any are missing.
     */
    private async checkFiles(
        library: ILibraryName,
        requiredFiles: string[]
    ): Promise<boolean> {
        const missingFiles = (await Promise.all(
            requiredFiles.map(async (file: string) => {
                return {
                    path: file,
                    status: await this.libraryStorage.fileExists(library, file)
                };
            })
        ))
            .filter((file: { status: boolean }) => !file.status)
            .map((file: { path: string }) => file.path);
        if (missingFiles.length > 0) {
            let message = `Error(s) in library ${LibraryName.toDirName(
                library
            )}:\n`;
            message += missingFiles
                .map((file: string) => `${file} is missing.`)
                .join('\n');
            throw new Error(message);
        }
        return true;
    }

    /**
     * Copies all library files from a directory (excludes library.json) to the storage.
     * Throws errors if something went wrong.
     * @param {string} fromDirectory The directory to copy from
     * @param {ILibraryName} libraryInfo the library object
     * @returns {Promise<void>}
     */
    private async copyLibraryFiles(
        fromDirectory: string,
        libraryInfo: ILibraryName
    ): Promise<void> {
        const files: string[] = await globPromise(`${fromDirectory}/**/*.*`);
        await Promise.all(
            files.map((fileFullPath: string) => {
                const fileLocalPath: string = path.relative(
                    fromDirectory,
                    fileFullPath
                );
                if (fileLocalPath === 'library.json') {
                    return Promise.resolve(true);
                }
                const readStream: Stream = fsExtra.createReadStream(
                    fileFullPath
                );
                return this.libraryStorage.addLibraryFile(
                    libraryInfo,
                    fileLocalPath,
                    readStream
                );
            })
        );
    }

    /**
     * Gets the parsed contents of a library file that is JSON.
     * @param {ILibraryName} library
     * @param {string} file
     * @returns {Promise<any|undefined>} The content or undefined if there was an error
     */
    private async getJsonFile(
        library: ILibraryName,
        file: string
    ): Promise<any> {
        const stream: Stream = await this.libraryStorage.getFileStream(
            library,
            file
        );
        const jsonString: string = await streamToString(stream);
        return JSON.parse(jsonString);
    }

    /**
     * Installs a library and rolls back changes if the library installation failed.
     * Throws errors if something went wrong.
     * @param {string} fromDirectory the local directory to install from
     * @param {ILibraryName} libraryInfo the library object
     * @param {any} libraryMetadata the library metadata
     * @param {boolean} restricted true if the library can only be installed with a special permission
     * @returns {IInstalledLibrary} the libray object (containing - among others - the id of the newly installed library)
     */
    private async installLibrary(
        fromDirectory: string,
        libraryMetadata: ILibraryMetadata,
        restricted: boolean
    ): Promise<IInstalledLibrary> {
        const newLibraryInfo = await this.libraryStorage.installLibrary(
            libraryMetadata,
            restricted
        );

        try {
            await this.copyLibraryFiles(fromDirectory, newLibraryInfo);
            await this.checkConsistency(libraryMetadata);
        } catch (error) {
            await this.libraryStorage.removeLibrary(libraryMetadata);
            throw error;
        }
        return newLibraryInfo;
    }

    /**
     * Updates the library to a new version.
     * REMOVES THE LIBRARY IF THERE IS AN ERROR!!!
     * @param filesDirectory the path of the directory containing the library files to update to
     * @param library the library object
     * @param newLibraryMetadata the library metadata (library.json)
     */
    private async updateLibrary(
        newLibraryMetadata: ILibraryMetadata,
        filesDirectory: string
    ): Promise<any> {
        try {
            await this.libraryStorage.updateLibrary(newLibraryMetadata);
            await this.libraryStorage.clearLibraryFiles(newLibraryMetadata);
            await this.copyLibraryFiles(filesDirectory, newLibraryMetadata);
            await this.checkConsistency(newLibraryMetadata);
        } catch (error) {
            await this.libraryStorage.removeLibrary(newLibraryMetadata);
            throw error;
        }
    }
}
