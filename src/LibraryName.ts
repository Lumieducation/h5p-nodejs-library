import H5pError from './helpers/H5pError';
import { ILibraryName } from './types';

export default class LibraryName implements ILibraryName {
    constructor(
        public machineName: string,
        public majorVersion: number,
        public minorVersion: number
    ) {}

    /**
     * Creates a library object from a library name
     * @param {string} libraryName The library name in a format "H5P.Example-1.0" or "H5P.Example 1.0" (see options)
     * @param {boolean} restricted true if the library is restricted
     * @param {boolean} useWhitespace true if the parser should accept names like "H5P.Library 1.0"
     * @param {boolean} useHyphen true if the parser should accept names like "H5P.Library-1.0"
     * @returns {Library} undefined if the name could not be parsed
     */
    public static fromUberName(
        libraryName: string,
        options: {
            useHyphen?: boolean;
            useWhitespace?: boolean;
        } = {
            useHyphen: true,
            useWhitespace: false
        }
    ): ILibraryName {
        if (!options.useHyphen && !options.useWhitespace) {
            throw new H5pError(
                'You must call fromUberName with either the useHyphen or useWhitespace option, or both!'
            );
        }
        const nameRegex: RegExp =
            options.useHyphen && options.useWhitespace
                ? /([^\s]+)[-\s](\d+)\.(\d+)/
                : options.useHyphen
                ? /([^\s]+)-(\d+)\.(\d+)/
                : /([^\s]+)\s(\d+)\.(\d+)/;

        const result: RegExpExecArray = nameRegex.exec(libraryName);

        if (!result) {
            return undefined;
        }

        return new LibraryName(
            result[1],
            Number.parseInt(result[2], 10),
            Number.parseInt(result[3], 10)
        );
    }

    /**
     * Returns the directory name that is used for this library (e.g. H5P.ExampleLibrary-1.0)
     */
    public static toUberName(
        libraryName: ILibraryName,
        options: {
            useHyphen?: boolean;
            useWhitespace?: boolean;
        } = {
            useHyphen: true,
            useWhitespace: false
        }
    ): string {
        if (options.useHyphen) {
            return `${libraryName.machineName}-${libraryName.majorVersion}.${libraryName.minorVersion}`;
        }
        if (options.useWhitespace) {
            return `${libraryName.machineName} ${libraryName.majorVersion}.${libraryName.minorVersion}`;
        }
        return '';
    }
}
