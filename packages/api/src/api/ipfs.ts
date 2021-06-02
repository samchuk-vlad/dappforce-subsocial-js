import { IpfsCid as RuntimeIpfsCid } from '@subsocial/types/substrate/interfaces';
import { CommonContent, SpaceContent, PostContent, CommentContent, CID, IpfsCid, ProfileContent } from '@subsocial/types/offchain';
import { newLogger, pluralize, isEmptyArray, nonEmptyStr } from '@subsocial/utils';
import axios, { AxiosRequestConfig, AxiosResponse } from 'axios';
import { getUniqueIds, isIpfs, asIpfsCid } from '../utils/common';
import { Content } from '@subsocial/types/substrate/classes';
import { SubsocialContext, ContentResult, UseServerProps } from '../utils/types';
import { SocialAccountWithId } from '@subsocial/types/dto';

/** Return IPFS cid by social account struct */
export function getIpfsCidOfSocialAccount (struct: SocialAccountWithId): string | undefined {
  const profile = struct?.profile
  if (profile && profile.isSome) {
    return getIpfsCidOfStruct(profile.unwrap())
  }
  return undefined
}

type HasContentField = {
  content: Content
}

type HasIpfsCidSomewhere = HasContentField | SocialAccountWithId
/** Return IPFS cid by struct that has a content field
 * @typeParam S ```
 * type HasContentField = {
 *   content: Content
 * }
 *
 * type HasIpfsCidSomewhere = HasContentField | SocialAccountWithId
 * ```
 * {@link Content}, {@link SocialAccountWithId}
*/
export function getIpfsCidOfStruct<S extends HasIpfsCidSomewhere> (struct: S): string | undefined {
  if (isIpfs((struct as HasContentField).content)) {
    return (struct as HasContentField).content.asIpfs.toString()
  } else if ((struct as SocialAccountWithId).profile) {
    return getIpfsCidOfSocialAccount(struct as SocialAccountWithId)
  }
  return undefined
}

/** Get an array of cids by starcts array
 * ```
 * type HasContentField = {
 *   content: Content
 * }
 * type HasIpfsCidSomewhere = HasContentField | SocialAccountWithId
 * ```
*/
export function getCidsOfStructs (structs: HasIpfsCidSomewhere[]): string[] {
  return structs
    .map(getIpfsCidOfStruct)
    .filter(cid => typeof cid !== 'undefined') as string[]
}

type IpfsUrl = string
type IpfsNodeEndpoint = 'cat' | 'version' | 'dag/get'

/**
 * ```
 * type IpfsUrl = string
 * type IpfsNodeEndpoint = 'cat' | 'version' | 'dag/get'
 * ````
 */
export type SubsocialIpfsProps = SubsocialContext & {
  ipfsNodeUrl: IpfsUrl,
  offchainUrl: string
}

/** Aggregated api for working with IPFS to get the content of the spaces of posts and profiles */
export class SubsocialIpfsApi {
  /** Ipfs node readonly geteway */
  private ipfsNodeUrl!: IpfsUrl // IPFS Node ReadOnly Gateway
  /** Offchain geteway */
  private offchainUrl!: string
  private useServer?: UseServerProps

  /** Sets values for ptivate fields from props and trying to make a test connection */
  constructor (props: SubsocialIpfsProps) {
    const { ipfsNodeUrl, offchainUrl, useServer } = props;

    this.ipfsNodeUrl = `${ipfsNodeUrl}/api/v0`
    this.offchainUrl = `${offchainUrl}/v1`
    this.useServer = useServer

    this.testConnection()
  }

  /** Trying to make a test connection  */
  private async testConnection () {
    if (this.useServer) return

    try {
      // Test IPFS Node connection by requesting its version
      const res = await this.ipfsNodeRequest('version')
      log.info('Connected to IPFS Node with version ', res.data.version)
    } catch (err) {
      log.error('Failed to connect to IPFS node:', err.stack)
    }
  }

  // ---------------------------------------------------------------------
  // IPFS Request wrapper

  /** Makes a request to the IPFS node */
  private async ipfsNodeRequest (endpoint: IpfsNodeEndpoint, cid?: CID): Promise<AxiosResponse<any>> {
    const config: AxiosRequestConfig = {
      method: 'GET',
      url: `${this.ipfsNodeUrl}/${endpoint}`
    };

    if (typeof cid !== undefined) {
      config.url += `?arg=${cid}`
    }

    return axios(config)
  }

  // ---------------------------------------------------------------------
  // Find multiple

  /** Return unique cids from cids array */
  getUniqueCids (cids: IpfsCid[], contentName?: string) {
    contentName = nonEmptyStr(contentName) ? `${contentName  } content` : 'content'
    const ipfsCids = getUniqueIds(cids.map(asIpfsCid))

    if (isEmptyArray(ipfsCids)) {
      log.debug(`No ${contentName} to load from IPFS: no cids provided`)
      return []
    }

    return ipfsCids
  }

  /** Return object with contents from IPFS by cids array */
  async getContentArrayFromIpfs<T extends CommonContent> (cids: IpfsCid[], contentName = 'content'): Promise<ContentResult<T>> {
    try {
      const ipfsCids = this.getUniqueCids(cids, contentName)

      const content: ContentResult<T> = {}

      const getFormatedContent = async (cid: CID) => {
        const res = await this.ipfsNodeRequest('dag/get', cid)
        const cidStr = cid.toString()
        content[cidStr] = res.data
      }

      const loadContentFns = ipfsCids.map(getFormatedContent);
      await Promise.all(loadContentFns);
      log.debug(`Loaded ${pluralize(cids.length, contentName)}`)
      return content
    } catch (err) {
      console.error(`Failed to load ${contentName}(s) by ${cids.length} cid(s):`, err)
      return {};
    }
  }

  /** Return object with contents from IPFS through offchain by cids array */
  async getContentArrayFromOffchain<T extends CommonContent> (cids: IpfsCid[], contentName = 'content'): Promise<ContentResult<T>> {
    try {

      const res = this.useServer?.httpRequestMethod === 'get'
        ? await axios.get(`${this.offchainUrl}/ipfs/get?cids=${cids.join('&cids=')}`)
        : await axios.post(`${this.offchainUrl}/ipfs/get`, { cids })

      if (res.status !== 200) {
        log.error(`${this.getContentArrayFromIpfs.name}: Offchain server responded with status code ${res.status} and message: ${res.statusText}`)
        return {}
      }

      const contents = res.data;
      log.debug(`Loaded ${pluralize(contents.length, contentName)}`)
      return contents;
    } catch (error) {
      log.error('Failed to get content from IPFS via Offchain API:', error)
      return {};
    }
  }

  async getContentArray<T extends CommonContent> (cids: IpfsCid[], contentName = 'content'): Promise<ContentResult<T>> {
    return this.useServer
      ? this.getContentArrayFromOffchain(cids, contentName)
      : this.getContentArrayFromIpfs(cids, contentName)
  }

  /** Get spaces content array by cid */
  async findSpaces (cids: IpfsCid[]): Promise<ContentResult<SpaceContent>> {
    return this.getContentArray(cids, 'space')
  }

  /** Get posts content array by cid */
  async findPosts (cids: IpfsCid[]): Promise<ContentResult<PostContent>> {
    return this.getContentArray(cids, 'post')
  }

  /** Get comments content array by cid */
  async findComments (cids: IpfsCid[]): Promise<ContentResult<CommentContent>> {
    return this.getContentArray(cids, 'comment')
  }

  /** Get profiles content array by cid */
  async findProfiles (cids: IpfsCid[]): Promise<ContentResult<ProfileContent>> {
    return this.getContentArray(cids, 'account')
  }

  // ---------------------------------------------------------------------
  // Find single

  async getContent<T extends CommonContent> (cid: IpfsCid, contentName?: string): Promise<T | undefined> {
    const content = await this.getContentArray<T>([ cid ], contentName)
    return content[cid.toString()]
  }

  /** Get single space content by cid */
  async findSpace (cid: IpfsCid): Promise<SpaceContent | undefined> {
    return this.getContent<SpaceContent>(cid, 'space')
  }

  /** Get single post content by cid */
  async findPost (cid: IpfsCid): Promise<PostContent | undefined> {
    return this.getContent<PostContent>(cid, 'post')
  }

  /** Get single comment content by cid */
  async findComment (cid: IpfsCid): Promise<CommentContent | undefined> {
    return this.getContent<CommentContent>(cid, 'comment')
  }

  /** Get single profile content by cid */
  async findProfile (cid: IpfsCid): Promise<ProfileContent | undefined> {
    return this.getContent<ProfileContent>(cid, 'account')
  }

  // ---------------------------------------------------------------------
  // Remove
  /** Unpin content in IPFS */
  async removeContent (cid: IpfsCid) {
    try {
      const res = await axios.delete(`${this.offchainUrl}/ipfs/pins/${cid}`);

      if (res.status !== 200) {
        log.error(`${this.removeContent.name}: offchain server responded with status code ${res.status} and message: ${res.statusText}`)
        return
      }

      log.info(`Unpinned content with hash: ${cid}`);
    } catch (error) {
      log.error('Failed to unpin content in IPFS from client side via offchain: ', error)
    }
  }

  /** Add and pin content in IPFS */
  async saveContent (content: CommonContent): Promise<RuntimeIpfsCid | undefined> {
    try {
      const res = await axios.post(`${this.offchainUrl}/ipfs/add`, content);

      if (res.status !== 200) {
        log.error(`${this.saveContent.name}: Offchain server responded with status code ${res.status} and message: ${res.statusText}`)
        return undefined
      }

      return res.data;
    } catch (error) {
      log.error('Failed to add content to IPFS from client side via offchain: ', error)
      return undefined;
    }
  }

  /** Add and pit file in IPFS */
  async saveFile (file: File | Blob) {
    if (typeof window === 'undefined') {
      throw new Error('This function works only in a browser')
    }

    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await axios.post(`${this.offchainUrl}/ipfs/addFile`, formData, {
        headers: {
          'Content-Type': 'multipart/form-data'
        }
      })

      if (res.status !== 200) {
        log.error(`${this.saveFile.name}: Offchain server responded with status code ${res.status} and message: ${res.statusText}`)
        return undefined
      }

      return res.data;
    } catch (error) {
      log.error('Failed to add file to IPFS from client side via offchain: ', error)
      return undefined;
    }
  }

  /** Add and pin space content in IPFS */
  async saveSpace (content: SpaceContent): Promise<RuntimeIpfsCid | undefined> {
    const hash = await this.saveContent(content)
    log.debug(`Saved space with hash: ${hash}`)
    return hash;
  }

  /** Add and pin post content in IPFS */
  async savePost (content: PostContent): Promise<RuntimeIpfsCid | undefined> {
    const hash = await this.saveContent(content)
    log.debug(`Saved post with hash: ${hash}`)
    return hash;
  }

  /** Add and pin comment content in IPFS */
  async saveComment (content: CommentContent): Promise<RuntimeIpfsCid | undefined> {
    const hash = await this.saveContent(content)
    log.debug(`Saved comment with hash: ${hash}`)
    return hash;
  }
}

const log = newLogger(SubsocialIpfsApi.name);