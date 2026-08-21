import * as React from 'react';
import { useCallback, useState } from 'react';
import { DeviceEventEmitter, EmitterSubscription, Modal, NativeModules, useColorScheme, View } from 'react-native';
import { Details } from './Components/Details';
import { Main } from './Components/Main';
import {
  clear as clearReduxActions,
  reduxLoggerMiddleware,
  setCallback as setReduxActionsCallback,
  setConfig as setReduxConfig,
  setMaxActions as setReduxMaxActions,
} from './Core/ReduxLogger';
import { RNLogger } from './Core/RNLogger';
import { ConnectionLogger } from './Core/ConnectionLogger';
import { RNRequest } from './Core/Objects/RNRequest';
import { ReduxAction } from './Core/Objects/ReduxAction';
import { NRequest } from './Core/Objects/NRequest';
import { ConnectionInfo } from './Core/Objects/ConnectionInfo';
import { ThemeContext, themes } from './Theme';
import {
  clearMockResponses,
  mockRequestWithResponse,
  MockResponse,
  resetMockResponses,
  setupMocks,
} from './Components/Mocking/utils';
import { MockingNavigator } from './Components/Mocking';
import { DarkTheme, Provider as PaperProvider } from 'react-native-paper';
import Clipboard from '@react-native-clipboard/clipboard';
import { LaunchArguments } from 'react-native-launch-arguments';

export interface IProps {
  visible?: boolean;
  onPressClose?: () => void;
  enabled?: boolean;
  disableShake?: boolean;
  interceptIOS?: boolean;
  maxRequests?: number;
  reduxConfig?: any;
  theme?: 'dark' | 'light';
  showStats?: boolean;
  useReactotron?: boolean;
  loadMockPresetFromClipboard?: boolean;
  loadMockPresetFromInputParameters?: boolean;
  mockPresets?: Array<MockResponse>;
}

export const reduxLogger = reduxLoggerMiddleware;
export const _RNLogger = new RNLogger();
export const _ConnectionLogger = new ConnectionLogger();

const { RNNetwatch } = NativeModules;
let nativeLoopStarted = false;
let nativeLoop: NodeJS.Timeout;

export const Netwatch: React.FC<IProps> = ({
  visible: visibleProp = false,
  onPressClose,
  enabled = true,
  disableShake = false,
  interceptIOS = true,
  maxRequests = 100,
  reduxConfig = {},
  theme = 'dark',
  showStats = true,
  useReactotron = false,
  loadMockPresetFromClipboard,
  loadMockPresetFromInputParameters,
  mockPresets,
}: IProps) => {
  const [reduxActions, setReduxActions] = useState<Array<ReduxAction>>([]);
  const [rnRequests, setRnRequests] = useState<Array<RNRequest>>([]);
  const [nRequests, setnRequests] = useState<Array<NRequest>>([]);
  const [connections, setConnections] = useState<Array<ConnectionInfo>>([]);
  const [showDetails, setShowDetails] = useState<boolean>(false);
  const [item, setItem] = useState(new ReduxAction());
  const [visible, setVisible] = useState(false);
  const [mockResponse, setMockResponse] = useState<MockResponse | undefined>();
  const [update, setUpdate] = useState(false);
  const [showMockNavigator, setShowMockNavigator] = useState<boolean>(false);

  let colorScheme = useColorScheme() || 'light';
  colorScheme = theme ?? colorScheme;

  // At this time, if it's not light, that will be dark. No other possibility
  const _theme = colorScheme === 'light' ? themes.light : themes.dark;

  // Extract data from shared pref and passed the result to the UI
  const getNativeRequests = useCallback((): void => {
    RNNetwatch.getNativeRequests((response: any) => {
      try {
        let _temp;
        try {
          _temp = JSON.parse(response.result);
        } catch (e) {
          _temp = response.result;
        }
        if (_temp && _temp instanceof Array && _temp.length > 0) {
          const _result = _temp.map((element: any) => {
            return new NRequest({
              _id: element._id,
              readyState: 4,
              url: element.url,
              shortUrl: element.url.slice(0, 100),
              method: element.method,
              status: element.status,
              startTime: element.startTime,
              endTime: element.endTime,
              timeout: element.timeout,
              dataSent: JSON.stringify(element.dataSent, null, 2),
              requestHeaders: element.requestHeaders,
              responseHeaders: element.responseHeaders,
              responseContentType: element.responseContentType,
              responseSize: element.responseSize,
              responseType: element.responseType,
              responseURL: element.responseURL,
              response: JSON.stringify(element.response, null, 2),
            });
          });
          setnRequests([..._result, ...nRequests]);
        }
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
      }
    });
  }, [nRequests]);

  React.useEffect(() => {
    if (visibleProp !== undefined) {
      setVisible(visibleProp);
    }
  }, [visibleProp]);

  const handleShake = useCallback(() => {
    if (!disableShake && onPressClose) {
      console.warn(
        'You cannot use button and shake at the same time to avoid inconsistant state. To remove this warning, you must explicitly set props disableShake to true or remove props onPressClose.',
      );
      return;
    }

    if (!disableShake && enabled) {
      setVisible(true);
    }
  }, [disableShake, enabled, onPressClose]);

  React.useEffect(() => {
    let subscription: EmitterSubscription | null = null;
    if (!disableShake && enabled) {
      subscription = DeviceEventEmitter.addListener('NetwatchShakeEvent', handleShake);
    }
    return () => {
      subscription?.remove?.();
    };
  }, [handleShake, disableShake, enabled]);

  const handleBack = () => {
    if (showDetails) {
      return setShowDetails(false);
    }
    onPressClose ? onPressClose() : setVisible(false);
  };

  const startNativeLoop = useCallback(() => {
    if (enabled && !nativeLoopStarted) {
      nativeLoopStarted = true;
      nativeLoop = setInterval(() => {
        getNativeRequests();
      }, 1500);
    }
  }, [getNativeRequests, enabled]);

  const stopNativeLoop = () => {
    nativeLoopStarted = false;
    clearInterval(nativeLoop);
  };

  const clearAll = () => {
    _RNLogger.clear();
    _ConnectionLogger.clearConnectionEvents();
    clearReduxActions();
    setReduxActions([]);
    setRnRequests([]);
    setnRequests([]);
    setConnections([]);
  };

  React.useEffect(() => {
    if (!enabled || useReactotron) {
      clearMockResponses();
      clearAll();
      stopNativeLoop();
      _ConnectionLogger.resetCallback();
      setReduxActionsCallback(() => {});
    }
  }, [enabled, useReactotron]);

  React.useEffect(() => {
    if (enabled) {
      if (interceptIOS) {
        RNNetwatch.startNetwatch();
      }
      startNativeLoop();
      _RNLogger.enableXHRInterception();
      _RNLogger.setCallback(setRnRequests);
      _ConnectionLogger.setCallback(setConnections);
      if (reduxConfig) {
        setReduxConfig(reduxConfig);
      }
      setReduxMaxActions(maxRequests);
      setReduxActionsCallback(setReduxActions);
    }
  }, [enabled, interceptIOS, maxRequests, reduxConfig, startNativeLoop, loadMockPresetFromClipboard]);

  React.useEffect(() => {
    if (enabled) {
      try {
        if (loadMockPresetFromInputParameters) {
          const args = LaunchArguments.value<{ netwatchMocks: MockResponse[] }>();
          if (args && args.netwatchMocks && Array.isArray(args.netwatchMocks)) {
            args.netwatchMocks.forEach(preset => {
              mockRequestWithResponse(preset);
            });
          }
        } else if (loadMockPresetFromClipboard) {
          Clipboard.getString().then(responses => {
            if (responses) {
              resetMockResponses(responses);
            }
          });
        } else if (Array.isArray(mockPresets)) {
          mockPresets.forEach(preset => {
            mockRequestWithResponse(preset);
          });
        }
      } catch (e) {
        console.error(e);
      }
      setupMocks();
    }
  }, [enabled, loadMockPresetFromClipboard, loadMockPresetFromInputParameters, mockPresets]);

  React.useEffect(() => {
    if (!visible) {
      stopNativeLoop();
      return;
    }
    startNativeLoop();
  }, [startNativeLoop, visible]);

  if (!enabled) {
    return null;
  }

  return (
    <ThemeContext.Provider value={_theme}>
      <PaperProvider theme={DarkTheme}>
        <Modal animationType="slide" visible={visible} onRequestClose={handleBack}>
          <View style={{ flex: 1 }}>
            <View style={{ height: showDetails ? 0 : '100%' }}>
              <Main
                maxRequests={maxRequests}
                testId="mainScreen"
                onPressClose={onPressClose || (() => setVisible(false))}
                onPressDetail={setShowDetails}
                onPress={setItem}
                reduxActions={reduxActions}
                rnRequests={rnRequests}
                nRequests={nRequests}
                connections={connections}
                clearAll={clearAll}
                showStats={showStats}
                onShowMocksList={() => {
                  setMockResponse(undefined);
                  setShowMockNavigator(true);
                }}
              />
            </View>
            <View style={{ height: showDetails ? '100%' : 0 }}>
              <Details
                onEditMockResponse={(mr, u) => {
                  setMockResponse(mr);
                  setUpdate(u);
                  setShowMockNavigator(true);
                }}
                testId="detailScreen"
                onPressBack={setShowDetails}
                item={item}
              />
            </View>
            <Modal
              animationType="slide"
              visible={showMockNavigator}
              statusBarTranslucent={true}
              onRequestClose={() => setShowMockNavigator(true)}
            >
              <MockingNavigator
                mockResponse={mockResponse}
                update={update}
                onPressBack={() => setShowMockNavigator(false)}
              />
            </Modal>
          </View>
        </Modal>
      </PaperProvider>
    </ThemeContext.Provider>
  );
};
