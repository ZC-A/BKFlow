/**
* Tencent is pleased to support the open source community by making 蓝鲸智云PaaS平台社区版 (BlueKing PaaS Community
* Edition) available.
* Copyright (C) 2017 THL A29 Limited, a Tencent company. All rights reserved.
* Licensed under the MIT License (the "License"); you may not use this file except in compliance with the License.
* You may obtain a copy of the License at
* http://opensource.org/licenses/MIT
* Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on
* an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the
* specific language governing permissions and limitations under the License.
*/
import tools from '@/utils/tools.js';
import { checkDataType } from '@/utils/checkDataType.js';

export const COMMON_ATTRS = {
  tagCode: {
    type: String,
    required: true,
    inner: true,
  },
  name: {
    type: String,
    required: true,
    default: '',
  },
  hookable: {
    type: Boolean,
    required: false,
    default: true,
  },
  validation: {
    type: Array,
    default() {
      return [];
    },
    desc: gettext('请输入校验规则，例如：[{type: required}, {type: custom, args: function(){ return {result: true, error_message: ""}}}]'),
  },
  default: {
    type: [String, Number, Boolean, Array, Object],
    required: false,
  },
  hidden: {
    type: Boolean,
    required: false,
    default: false,
  },
  formEdit: {
    type: Boolean,
    default: true,
    inner: true,
  },
  formMode: {
    type: Boolean,
    default: true,
    inner: true,
  },
  formViewHidden: { // 表单项为非编辑状态时，是否隐藏，例如(JOB执行作业刷新按钮)
    type: Boolean,
    default: false,
  },
  cols: { // 横向栅格占有的格数，总数为 12 格
    type: Number,
    default: 0,
  },
  validateSet: {
    type: Array,
    inner: true,
    default() {
      return [];
    },
  },
  parentValue: {
    type: [String, Number, Boolean, Array, Object],
    inner: true,
  },
};

export const getFormMixins = (attrs = {}) => {
  attrs = tools.deepClone(attrs);
  const inheritAttrs = {}; // 继承属性
  const noInheritAttrs = {}; // 非继承属性

  Object.keys(attrs).forEach((item) => {
    if (item !== 'value') {
      const attrsDefault = attrs[item].default;
      let attrsValue;

      if (typeof attrsDefault === 'function') {
        attrsValue = attrs[item].type === Function ? attrsDefault : attrsDefault();
      } else {
        attrsValue = attrsDefault;
      }
      noInheritAttrs[item] = attrsValue;
    } else {
      inheritAttrs[item] = tools.deepClone(attrs[item]);
    }
  });

  return {
    model: {
      prop: 'value',
      event: 'change',
    },
    inject: ['getFormData'],
    props: {
      ...COMMON_ATTRS, // 公共属性
      ...inheritAttrs, // tag 继承属性(value)
      hook: {
        type: Boolean,
        default: false,
      },
      constants: {
        type: Object,
        default() {
          return {};
        },
      },
      atomEvents: {
        type: Array,
        default() {
          return [];
        },
      },
      atomMethods: {
        type: Object,
        default() {
          return {};
        },
      },
    },
    data() {
      const noInheritData = {};
      // 非 prop 属性注册到 data 对象
      // 优先取标准插件配置项里的值
      Object.keys(noInheritAttrs).forEach((item) => {
        noInheritData[item] = Object.prototype.hasOwnProperty.call(this.$attrs, item)
          ? this.$attrs[item]
          : noInheritAttrs[item];
      });

      return {
        eventActions: {}, // 标准插件配置项定义的事件回调函数
        validateInfo: {
          valid: true,
          message: '',
        },
        editable: this.formEdit,
        ...noInheritData,
      };
    },
    created() {
      // 注册标准插件配置项里的事件函数到父父组件实例
      // 父父组件目前包括 RenderForm(根组件)、FormGroup(combine 类型)、TagDataTable(表格类型)
      this.atomEvents.forEach((item) => {
        const eventSource = `${item.source}_${item.type}`;
        this.eventActions[eventSource] = this.getEventHandler(item.action);
        this.$parent.$parent.$on(eventSource, this.eventActions[eventSource]);
      });

      // 注册标准插件配置项 methods 属性里的方法到 Tag 实例组件
      // 标准插件配置项里的方法会重载 mixins 里定义的方法
      Object.keys(this.atomMethods).forEach((item) => {
        if (typeof this.atomMethods[item] === 'function') {
          this[item] = this.atomMethods[item];
        }
      });
    },
    mounted() {
      // 部分 Tag 组件需要执行初始化操作
      if (typeof this._tag_init === 'function') {
        this._tag_init();
      }

      // 组件插入到 DOM 后， 在父父组件上发布该 Tag 组件的 init 事件，触发标准插件配置项里监听的函数
      this.$nextTick(() => {
        this.emit_event(this.tagCode, 'init', this.value);
        this.$emit('init', this.value);
      });
    },
    beforeDestroy() {
      this.atomEvents.forEach((item) => {
        const eventSource = `${item.source}_${item.type}`;
        this.$parent.$parent.$off(eventSource, this.eventActions[eventSource]);
      });
    },
    methods: {
      updateForm(val) {
        const fieldsArr = [this.tagCode];
        this.$emit('change', fieldsArr, val);
        this.$nextTick(() => {
          this.onChange();
          this.validate();
        });
      },
      /**
             * formItem 组件校验方法，默认调用通用校验规则
             * 若在 tag 内有自定义校验方法 customValidate，则调用该方法执行校验
             *
             * @returns {Boolean} isValid 校验结果是否合法
             */
      validate() {
        if (this.customValidate) {
          return this.customValidate();
        }
        if (!this.validation) return true;

        const isValid = this.validation.every((item) => {
          const result = this.getValidateResult(item, this.value, this.parentValue);
          this.validateInfo = result;
          return result.valid;
        });
        return isValid;
      },
      /**
             * 通用校验规则
             * @param {Object} config tag 配置项
             * @param {Any} value tag 值
             * @param {Object} parentValue 父组件值
             *
             * @returns {Object} 校验结果和提示信息
             */
      getValidateResult(config, value, parentValue) {
        let valid = true;
        let message = '';
        if (this.validateSet.includes(config.type)) {
          switch (config.type) {
            case 'required': {
              const valueType = checkDataType(value);
              let valueEmpty = false;
              if (valueType === 'Object') {
                valueEmpty = !Object.keys(value).length;
              } else if (valueType === 'Array') {
                valueEmpty = !value.filter(item => item).length;
              } else if (valueType === 'String') {
                valueEmpty = !value.length;
              } else if (valueType === 'Number') {
                valueEmpty = !value.toString();
              }
              if (valueEmpty) {
                valid = false;
                message = gettext('必填项');
              }
              break;
            }
            case 'regex':
              if (!/^\${[^${}]+}$/.test(value)) {
                const reg = new RegExp(config.args);
                if (!reg.test(value)) {
                  valid = false;
                  message = config.error_message;
                }
              }
              break;
            case 'custom':
              if (!/^\${[^${}]+}$/.test(value)) {
                const validateInfo = config.args.call(this, value, parentValue);
                if (!validateInfo.result) {
                  valid = false;
                  message = validateInfo.error_message;
                }
              }
              break;
            default:
              break;
          }
        }

        return { valid, message };
      },
      getEventHandler(action) {
        return (data) => {
          action.call(this, data);
        };
      },
      emit_event(name, type, data) {
        this.$parent.$parent.$emit(`${name}_${type}`, data);
      },
      onChange() {
        this.emit_event(this.tagCode, 'change', this.value);
      },
      show() {
        this.$emit('onShow');
      },
      hide() {
        // 隐藏变量需要取消勾选
        this.changeHook(false);
        this.$emit('onHide');
      },
      changeHook(val) {
        this.$parent.onHookForm(val);
      },
      // 获取 form 项实例
      get_form_instance() {
        return this.$parent;
      },
      // 获取 combine 实例或根元素实例
      get_parent() {
        return this.$parent.$parent;
      },
      /**
             * 获取当前 tag 组件值
             * @param {Boolean} keepValKey 表单勾选后是否返回当前变量 key 值
             */
      get_value(keepValKey) {
        return this._get_value(keepValKey);
      },
      _get_value(keepValKey = false) {
        let value;
        if (keepValKey) {
          value = this.value;
        } else {
          if (this.hook && this.constants) {
            const key = /^\$\{(\w+)\}$/.test(this.tagCode) ? this.tagCode : `\${${this.tagCode}}`;
            const variable = this.constants[key];
            return variable ? variable.value : this.value;
          }
          value = this.value;
        }
        return value;
      },
      /**
             * 获取标准插件任意表单项的值
             * @param {Array} path 目标 tag 表单的层级，表单值从标准插件最外层开始查找
             * @param {Object} data 表单值
             */
      get_tag_value(path, data = this.getFormData()) {
        const tag = path[0];
        if (!(tag in data)) {
          throw new Error(`表单值中不存在 ${tag} 属性`);
        }
        let result;
        if (path.length === 1) {
          result = tools.deepClone(data[tag]);
        } else {
          result = this.get_tag_value(path.slice(1), data[tag]);
        }
        return result;
      },
      /**
             * 设置当前 tag 组件值
             * @param {Any} value
             */
      set_value(value) {
        this._set_value(value);
      },
      _set_value(value) {
        this.updateForm(value);
      },
      // 获取 全局变量值
      getVariableVal(key) {
        const globalVariable = $.context.getConstants();
        if (globalVariable) {
          if (globalVariable[key]) {
            return globalVariable[key].value;
          }
          throw new Error(`${key}值 匹配不到变量`);
        } else {
          throw new Error('获取不到全局变量');
        }
      },
    },
  };
};
