# 通用小程序请求库封装

## 介绍

基于微信小程序请求库标准二次封装，实现了一些常用的功能，同时保留原请求库基础配置选项。可以实现大部分小程序请求库的通用使用，比如：`wx.request`,`uni.request`,`taro.rquest`等。

## 功能

-   [x] 请求重试
-   [x] 取消重复请求
-   [x] 请求节流
-   [x] 自定义拦截器
-   [x] 请求等待
-   [x] 请求并发限制

## 使用

基于 `wx.request`扩展的配置：

| 参数         | 默认值 | 说明                                                                                            |
| ------------ | ------ | ----------------------------------------------------------------------------------------------- |
| retry        | false  | 配置是否重试                                                                                    |
| retryCount   | 3      | 最大重试次数                                                                                    |
| retryDelay   | 100    | 重试延迟，单位 毫秒                                                                             |
| params       | -      | 请求 Query 对象，参考 axios                                                                     |
| loading      | false  | 是否开启加载                                                                                    |
| notify       | true   | 是否自动提示                                                                                    |
| enableCancel | true   | 是否允许取消请求，在 app.vue 或者 main.ts 周期的请求，建议使用 false，开启后可实现防抖效果      |
| throttle     | false  | 是否开启节流，开启后同一个请求需要排队，主要用于重复提交表单的场景（比如订单提交）              |
| wait         | false  | 是否开启请求等待，开启后，其他请求会等待当前请求结束之后，进行请求（可用于登录或者 token 刷新） |
| prefix       | -      | 请求前缀，一般用于接口版本（比如 v2）或者其他前缀情况                                           |
| maxQueue     | -      | 请求并发限制，默认不限制，目前京东小程序限制 5 个                                               |

返回事件：

| 名称       | 说明                             |
| ---------- | -------------------------------- |
| request    | 具体请求                         |
| clearQueue | 清空请求队列，可用于路由切换场景 |

安装：

```typescript
npm i -S @easyfe/mini-request
```

创建请求实例：

```typescript
import loading from "./loading";
import MpRequest from "@easyfe/mini-request";
const app = getApp<AppOption>();
//初始化请求库，需要传入请求实例，以及相应拦截器
const service = new MpRequest(wx.request, {
    base: {
        timeout: 0,
        baseUrl: process.env.CHEERS_MP_API,
        retry: false,
        url: "",
        prefix: "",
        header: {
            "access-token": app.globalData.token
        }
    },
    loading,
    interceptors: {
        request(config) {
            //请求拦截器，可以统一传入token等。
            config.header = {
                "access-token": "xxx",
                ...config.header
            };
            return Promise.resolve(config);
        },
        response(res) {
            //响应拦截器，小程序中状态码400、500也会进入到这里，因此根据实际业务判断statusCode
            if (process.env.NODE_ENV === "production") {
                console.log(`接口"${res.config.url}"`, `传参数是：`, res.config.data, `返回数据结构为:`, res.data);
            }
            //业务逻辑判断
            if (res.data.code !== 200) {
                //如果业务逻辑错误，则直接reject返回值，可在此对res进行其他处理
                return Promise.reject(res);
            }
            //如果请求正常，需要返回具体的请求结果，该结果将被请求业务逻辑直接使用
            return Promise.resolve(res.data);
        },
        responseError(err) {
            //异常拦截器，这时候一般拿到的是业务域名未配置、或者一些其他请求问题，与业务逻辑无关了，直接返回即可
            return Promise.reject(err);
        }
    }
});

const request = service.request;

export default request;
```

创建加载器（该加载器实现了合并 loading 的功能）：

```typescript
let reqNum = 0;
const loading = {
    showLoading() {
        if (reqNum === 0) {
            wx.showLoading({
                title: "加载中..."
            });
        }
        reqNum++;
    },
    clearLoading() {
        /** 合并loading */
        return new Promise((resolve) => {
            setTimeout(() => {
                closeLoading();
                resolve(true);
            }, 300);
        });
    },
    showToast(err) {
        wx.showToast({
            title: err.message || err.errMsg || err.msg || String(err),
            icon: "none",
            duration: 3 * 1000
        });
    },
    clearToast() {
        wx.hideToast({});
    }
};
/** 关闭loading */
function closeLoading(): void {
    if (reqNum <= 0) {
        return;
    }
    reqNum--;
    if (reqNum === 0) {
        wx.hideLoading();
    }
}

export default loading;
```

使用：

```typescript
import request from "@/packages/request/index";

export function Test(params: listParams): Promise<string> {
    return request({
        url: "/test",
        method: "get",
        retry: true,
        params
    });
}
```
