export interface GithubReleaseApiItem {
  tag_name?: string;
  body?: string;
  published_at?: string;
  html_url?: string;
  draft?: boolean;
  prerelease?: boolean;
}

export interface ReleaseNotesPage {
  key: string;
  label: string;
  version?: string;
  modifiedDate?: string;
  markdown: string;
}

export interface GuidePage {
  key: string;
  label: string;
  markdown: string;
  sourcePath: string;
}

export interface GuideCategory {
  key: string;
  label: string;
  icon: string;
  sections: Array<{ title?: string; pageKeys: string[] }>;
}