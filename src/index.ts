import { RequestQueueType, RequestTask, WxRequestBaseConfig, WxRequestConfig, WxRequestResponse } from "./types/index";
import { clone as cloneDeep } from "./util";

// 定义常见http状态码错误
const httpStatus: { [key: number]: string } = {
    400: "请求参数错误",
    401: "未授权，请登录",
    403: "服务器拒绝访问",
    404: "404 Not Found",
    405: "请求方法不允许",
    408: "请求超时",
    500: "服务器内部错误",
    501: "服务未实现",
    502: "网关错误",
    503: "服务不可用",
    504: "网关超时",
    505: "HTTP版本不受支持"
};

type QueueInstance = RequestTask | (() => RequestTask);

type WxRequestBaseConfigWithKey = WxRequestBaseConfig & { key: symbol };

type QueueDetail = { config: WxRequestBaseConfigWithKey; instance: QueueInstance };

class WxRequest {
    /** 请求MAP */
    private processQueue: Map<symbol, QueueDetail> = new Map();
    /** 请求等待MAP */
    private peddingQueue: Map<symbol, QueueDetail> = new Map();
    /** 请求配置 */
    private requestConfig: WxRequestConfig | null = null;
    /** 请求方法实例 */
    private requestInstance: any;

    /** 构造函数，创建配置文件 */
    constructor(requestInstance: any, requestConfig: WxRequestConfig) {
        this.requestConfig = requestConfig;
        this.requestInstance = requestInstance;
    }

    /** 清空请求队列 */
    clearQueue = (): void => {
        const queue = [...this.processQueue, ...this.peddingQueue];
        for (const [key, item] of queue) {
            if (item.config.wait) {
                continue;
            }
            if (!(item.instance instanceof Function)) {
                item.instance?.abort?.();
            }
            this.processQueue.delete(key);
            this.peddingQueue.delete(key);
        }
    };

    /** 请求方法 */
    request = <T>(config: WxRequestBaseConfig): Promise<T> => {
        return new Promise((resolve, reject) => {
            if (!this.requestConfig) {
                reject("初始化配置项失败");
                return;
            }
            /** 深拷贝基础配置项，防止合并污染 */
            const requestConfig = cloneDeep(this.requestConfig);
            /** 给method默认值 */
            if (!requestConfig.base.method) {
                requestConfig.base.method = "GET";
            }
            /** 合并配置项 */
            requestConfig.base = { ...requestConfig.base, ...config };
            /** 执行请求拦截 */
            requestConfig.interceptors
                .request(requestConfig.base)
                .then(() => {
                    /** 请求前缀配置 */
                    if (config.prefix !== undefined && !config.retryActiveCount) {
                        config.baseUrl = `${config.baseUrl}${config.prefix}`;
                    }
                    /** 如果配置了loading */
                    if (config.loading && !config.retryActiveCount) {
                        requestConfig.loading.showLoading();
                    }
                    /** 执行实际请求 */
                    return this.wxPrommise(requestConfig.base);
                })
                .then((res) => {
                    /** 执行响应拦截 */
                    return requestConfig?.interceptors.response(res);
                })
                .then((res) => {
                    /** 清除loading */
                    requestConfig?.loading?.clearLoading();
                    /** 返回请求结果 */
                    resolve(res);
                })
                .catch((err) => {
                    /** 不存在配置文件，说明是特殊异常错误，直接抛出即可 */
                    if (!err.config) {
                        if (
                            config.notify !== false &&
                            err.message !== "request:fail fast" &&
                            err.errMsg !== "request:fail abort"
                        ) {
                            requestConfig?.loading.showToast(err);
                        }
                        reject(err);
                        return;
                    }
                    /** 存在配置文件，进入异常处理流程 */
                    this._retry(err)
                        .then((res) => {
                            resolve(res);
                        })
                        .catch((err) => {
                            /** 执行异常拦截 */
                            requestConfig?.interceptors.responseError(err).catch((r) => {
                                reject(r);
                            });
                        });
                });
        });
    };

    /** 请求核心 */
    private wxPrommise(config: WxRequestBaseConfig): Promise<WxRequestResponse> {
        return new Promise((resolve, reject) => {
            /** url如果是完整域名，则直接使用 */
            let url = "";
            if (/^http(s)?:\/\/.*$/.test(config.url)) {
                url = config.url;
            } else {
                url = `${config.baseUrl || ""}${config.prefix || ""}${config.url}`;
            }
            /** 如果存在params对象，则拼接到url上 */
            if (config.params instanceof Object && JSON.stringify(config.params) !== "{}") {
                const params = config.params;
                const urlPamras = Object.keys(params)
                    .map((key) => `${key}=${params[key]}`)
                    .join("&");
                if (url.indexOf("?") === -1) {
                    url = `${url}?${urlPamras}`;
                } else {
                    url = `${url}&${urlPamras}`;
                }
            }
            const key = Symbol("requestid");
            const configWithKey = { ...config, key };
            const instance = (): RequestTask =>
                this.requestInstance({
                    url: url,
                    header: configWithKey.header,
                    method: configWithKey.method,
                    data: configWithKey.data,
                    responseType: configWithKey.responseType || "text",
                    success: (res: WxRequestResponse) => {
                        res.config = configWithKey;
                        resolve(res);
                    },
                    fail: (err: WechatMiniprogram.GeneralCallbackResult) => {
                        reject(err);
                    },
                    complete: () => {
                        this.processQueue.delete(key);
                        setTimeout(() => {
                            //这里必须使用方法调用，如果把方法内容提取出来在这里，会重复执行
                            this._addNextProcess();
                        });
                    }
                });
            const adoptRes = this._queueAdopt(configWithKey);
            if (adoptRes) {
                reject(adoptRes);
                return;
            }
            const [firstKey] = this.processQueue.keys();
            if (
                this.processQueue.size < (this.requestConfig?.base?.maxQueue || Infinity) &&
                this.processQueue.get(firstKey)?.config.wait !== true
            ) {
                this._addQueue({
                    key,
                    queueType: "process",
                    config: configWithKey,
                    instance: instance()
                });
            } else {
                this._addQueue({
                    key,
                    queueType: "pedding",
                    config: configWithKey,
                    instance: instance
                });
            }
        });
    }

    /** 执行下一个请求 */
    private _addNextProcess = (): any => {
        const [key] = this.peddingQueue.keys();
        const item = this.peddingQueue.get(key);
        if (item && item.instance instanceof Function) {
            this._addQueue({
                key,
                queueType: "process",
                config: item.config,
                instance: item.instance()
            });
            this.peddingQueue.delete(key);
        }
    };

    /**
     * 拦截防抖和节流
     * @param config
     * @returns
     */
    private _queueAdopt(config: WxRequestBaseConfigWithKey): Error | null {
        const checkFn = (queue: Map<symbol, QueueDetail>): Error | null => {
            for (const [key, item] of queue) {
                if (item.config.url === config.url && item.config.method === config.method) {
                    // 如果配置了节流，则拦截本次请求
                    if (config.throttle) {
                        return new Error("request:fail fast");
                    }
                    //如果配置了防抖，则取消重复请求
                    if (item.config.enableCancel) {
                        if (!(item.instance instanceof Function)) {
                            item.instance?.abort?.();
                        }
                        queue.delete(key);
                    }
                }
            }
            return null;
        };
        return checkFn(this.processQueue) || checkFn(this.peddingQueue);
    }

    /** 添加请求队列 */
    private _addQueue(data: {
        key: symbol;
        queueType: "process" | "pedding";
        config: WxRequestBaseConfigWithKey;
        instance: QueueInstance;
    }): void {
        //添加队列
        let _queue: Map<any, any> = new Map();
        if (data.queueType === "process") {
            _queue = this.processQueue;
        } else {
            _queue = this.peddingQueue;
        }
        _queue.set(data.key, {
            instance: data.instance,
            config: {
                url: data.config.url,
                method: data.config.method,
                params: data.config.params,
                data: data.config.data,
                //默认允许取消请求
                enableCancel: data.config.enableCancel ?? true,
                //默认不开启等待
                wait: data.config.wait ?? false
            }
        });
    }

    /** 请求重试 */
    private _retry(response: WxRequestResponse): Promise<any> {
        const config = response.config;
        if (config.retryActiveCount === undefined) {
            //设置当前重试第几次，默认0
            config.retryActiveCount = 0;
        }
        if (config.retryCount === undefined) {
            //设置重置最大次数，默认3
            config.retryCount = 3;
        }
        if (config.throttle) {
            //如果配置了节流，则重试前删除队列中的当前请求
            this.processQueue.delete(config.key);
        }
        /**
         * 直接返回错误情况
         * 1、重试次数超出上限
         * 2、未开启重试
         */
        if (config.retryActiveCount >= config.retryCount || config.retry !== true) {
            this.processQueue.delete(config.key);
            this.peddingQueue.delete(config.key);
            return new Promise((_, reject) => {
                this._reject(response).catch((err) => {
                    reject(err);
                });
            });
        }
        config.retryActiveCount += 1;
        return new Promise((resolve) => {
            setTimeout(() => {
                resolve(this.request(response.config));
            }, config.retryDelay || 100);
        });
    }

    /** 抛出请求异常 */
    private async _reject(response: WxRequestResponse): Promise<any> {
        if (!this.requestConfig) {
            return Promise.reject(new Error("配置初始化失败"));
        }
        /** 清除loading */
        await this.requestConfig.loading.clearLoading();
        this.processQueue.delete(response.config.key);
        if (response.config.notify === false) {
            //如果不需要进行全局错误提示的情况，直接返回promise
            return Promise.reject(response.data);
        }
        //进行全局错误提示
        if (response.data) {
            //如果后端返回了具体错误内容
            this.requestConfig.loading.showToast(response.data);
            return Promise.reject(response.data);
        }
        if (response.statusCode && httpStatus[response.statusCode]) {
            // 存在错误状态码
            this.requestConfig.loading.showToast(new Error(httpStatus[response.statusCode]));
            return Promise.reject(new Error(httpStatus[response.statusCode]));
        }
        //如果没有具体错误内容，找后端
        console.error(`后端接口未按照约定返回，请注意：\n${response.config.url}`);
        this.requestConfig.loading.showToast(new Error("未知错误，请稍后再试"));
        return Promise.reject(new Error("未知错误，请稍后再试"));
    }
}

export default WxRequest;
export { RequestQueueType, WxRequestBaseConfig, WxRequestConfig, WxRequestResponse };
