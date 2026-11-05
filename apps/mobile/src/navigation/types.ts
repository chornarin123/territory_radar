import type { NavigatorScreenParams } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { LoanType } from '../data/areaDemand';

export type TabParamList = {
  Today: undefined;
  /** `view`: which Radar view to show when arriving from elsewhere. */
  Radar: { view?: 'prospects' } | undefined;
  Prospects: undefined;
  /** `preselect`: prospect ids to tick on Plan visits (from Ask Radar). */
  Visits: { preselect?: string[] } | undefined;
  Profile: undefined;
};

export type RootStackParamList = {
  Tabs: NavigatorScreenParams<TabParamList> | undefined;
  ProspectDetail: { id: string };
  /** `question` is sent as the first message, once. */
  Coach: { id: string; question?: string };
  Filters: undefined;
  /** Drill-down area picker for the Prospects filter. */
  AreaPicker: undefined;
  /** Why a sangkat scores what it does; `chat` opens Ask Radar straight away. */
  Evidence: { code: string; loanType: LoanType; chat?: boolean };
};

export type RootScreenProps<T extends keyof RootStackParamList> = NativeStackScreenProps<
  RootStackParamList,
  T
>;

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace ReactNavigation {
    // Types useNavigation() app-wide.
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface RootParamList extends RootStackParamList {}
  }
}
