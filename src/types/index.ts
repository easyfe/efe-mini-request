/** 请求库基础配置 */
export interface WxRequestBaseConfig extends WechatMiniprogram.RequestOption {
    /**query参数 */
    params?: Record<string, any>;
    /**基础url */
    baseUrl?: string;
    /**是否重试（默认关闭）*/
    retry?: boolean;
    /**最大重试次数（默认3次）*/
    retryCount?: number;
    /**重试延迟（默认100毫秒）*/
    retryDelay?: number;
    /**当前重试次数*/
    retryActiveCount?: number;
    /**是否开启加载（默认关闭）*/
    loading?: boolean;
    /**是否开启提示（默认开启）*/
    notify?: boolean;
    /**是否允许主动取消请求（默认开启），允许后，可以实现队列功能，默认返回最后一个请求结果*/
    enableCancel?: boolean;
    /**是否开启节流（默认关闭），开启后同一个请求需要排队*/
    throttle?: boolean;
    /**是否开启请求等待（默认关闭），开启后，其他请求会等待当前请求结束之后，进行请求*/
    wait?: boolean;
    /** 接口前缀 */
    prefix?: string;
    /** 同时最大请求数量 */
    maxQueue?: number;
}

/** 完整请求配置 */
export interface WxRequestConfig {
    /** WxRequest基础配置 */
    base: WxRequestBaseConfig;
    /** 加载器 */
    loading: {
        showLoading: () => void;
        clearLoading: () => void | Promise<any>;
        showToast: (e: string) => void;
        clearToast: () => void;
    };
    /** 拦截器 */
    interceptors: {
        /** 请求拦截器 */
        request: (customConfig: WxRequestBaseConfig) => Promise<any>;
        /** HTTP请求成功响应拦截器，返回一个Promise，需要实现message定义 */
        response: (customResponse: WxRequestResponse) => Promise<any>;
        /** HTTP请求失败响应拦截器，返回一个Promise，需要实现message定义 */
        responseError: (customResponse: WechatMiniprogram.GeneralCallbackResult) => Promise<any>;
    };
}

/** 返回结果 */
export interface WxRequestResponse extends WechatMiniprogram.RequestSuccessCallbackResult<any> {
    config: WxRequestBaseConfig & { key: symbol };
}

export type RequestTask = WechatMiniprogram.RequestTask;

/** 请求队列 */
export interface RequestQueueType {
    /** 请求实体 */
    instance: RequestTask;
    /**请求url*/
    url?: string;
    /**请求方法*/
    method?: string;
    /**请求参数*/
    params: any;
    /**请求body*/
    data: any;
    /**是否允许取消请求*/
    enableCancel: boolean;
    /**请求等待*/
    wait: boolean;
}
