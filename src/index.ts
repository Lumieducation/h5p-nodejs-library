// Classes
import H5PEditor from './H5PEditor';
import H5PPlayer from './H5PPlayer';
import H5pError from './helpers/H5pError';
import InstalledLibrary from './InstalledLibrary';
import LibraryName from './LibraryName';
import PackageExporter from './PackageExporter';

import H5PConfig from './implementation/H5PConfig';
import fs from './implementation/fs';
import DirectoryTemporaryFileStorage from './implementation/fs/DirectoryTemporaryFileStorage';
import FileContentStorage from './implementation/fs/FileContentStorage';
import FileLibraryStorage from './implementation/fs/FileLibraryStorage';
import JsonStorage from './implementation/fs/JsonStorage';
import InMemoryStorage from './implementation/InMemoryStorage';
import CachedLibraryStorage from './implementation/cache/CachedLibraryStorage';

// Interfaces
import {
    ContentId,
    ContentParameters,
    IContentMetadata,
    IContentStorage,
    IH5PConfig,
    IInstalledLibrary,
    IKeyValueStorage,
    ILibraryFileUrlResolver,
    ILibraryMetadata,
    ILibraryName,
    ILibraryStorage,
    IPlayerModel,
    ITemporaryFile,
    ITemporaryFileStorage,
    ITranslationFunction,
    IUser,
    Permission,
    ILibraryAdministrationOverviewItem,
    IFileStats
} from './types';

// Adapters
import LibraryAdministration from './LibraryAdministration';

const fsImplementations = {
    DirectoryTemporaryFileStorage,
    FileContentStorage,
    FileLibraryStorage,
    InMemoryStorage,
    JsonStorage
};

const cacheImplementations = {
    CachedLibraryStorage
};

export {
    // classes
    H5PEditor,
    H5pError,
    H5PPlayer,
    InstalledLibrary,
    LibraryName,
    PackageExporter,
    LibraryAdministration,
    // interfaces
    ContentId,
    ContentParameters,
    IContentMetadata,
    IContentStorage,
    IH5PConfig,
    IInstalledLibrary,
    IKeyValueStorage,
    ILibraryFileUrlResolver,
    ILibraryMetadata,
    ILibraryName,
    ILibraryStorage,
    ILibraryAdministrationOverviewItem,
    IPlayerModel,
    ITemporaryFile,
    ITemporaryFileStorage,
    ITranslationFunction,
    IUser,
    Permission,
    IFileStats,
    // implementations
    H5PConfig,
    fs,
    fsImplementations,
    cacheImplementations
};
