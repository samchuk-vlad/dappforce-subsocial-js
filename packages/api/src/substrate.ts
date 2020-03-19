import { Blog, Post, Comment, CommonStruct, SubstrateId } from '@subsocial/types/substrate/interfaces';
import { getFirstOrUndefinded } from './utils';
import { ApiPromise as SubstrateApi } from '@polkadot/api';
import { Option } from '@polkadot/types';

export class SubsocialSubstrateApi {

  private api: SubstrateApi // Polkadot Api (connected)

  constructor (api: SubstrateApi) {
    this.api = api
    console.log('Created SubsocialSubstrateApi instance')
  }

  socialQuery = () => this.api.query.social;

  // ---------------------------------------------------------------------
  // Multiple

  async findStructs<T extends CommonStruct> (methodName: string, ids: SubstrateId[]): Promise<T[]> {
    try {
      const optionStruct = await this.socialQuery()[methodName].multi(ids) as unknown as Option<any>[];
      const optionFillStruct = optionStruct.filter(x => x.isSome);
      return optionFillStruct.map(x => x.unwrap());
    } catch (error) {
      console.error('Failed to load structs from Substrate by ids. Error:', error);
      return [];
    }
  }

  async findBlogs (ids: SubstrateId[]): Promise<Blog[]> {
    return this.findStructs('blogById', ids);
  }

  async findPosts (ids: SubstrateId[]): Promise<Post[]> {
    return this.findStructs('postById', ids);
  }

  async findComments (ids: SubstrateId[]): Promise<Comment[]> {
    return this.findStructs('commentById', ids);
  }

  async findStructsAndSubscribe<T extends CommonStruct> (methodName: string, args: SubstrateId[]): Promise<T[]> {
    const optionStruct = await this.socialQuery()[methodName].multi(args) as unknown as Option<any>[];
    return optionStruct.filter(x => x.isSome).map(x => x.unwrapOr(undefined)) as T[];
  } // TODO create functions

  // ---------------------------------------------------------------------
  // Single

  async findBlog (id: SubstrateId): Promise<Blog | undefined> {
    return getFirstOrUndefinded(await this.findBlogs([ id ]))
  }

  async findPost (id: SubstrateId): Promise<Post | undefined> {
    return getFirstOrUndefinded(await this.findPosts([ id ]))
  }

  async findComment (id: SubstrateId): Promise<Comment | undefined> {
    return getFirstOrUndefinded(await this.findComments([ id ]))
  }
}