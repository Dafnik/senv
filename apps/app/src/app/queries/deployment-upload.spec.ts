import { provideHttpClient } from '@angular/common/http';
import {
  provideHttpClientTesting,
  HttpTestingController,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, expect, test } from 'vite-plus/test';
import { environment } from '../../environments/environment';
import { DeploymentUpload } from './deployment-upload';

beforeEach(() => {
  TestBed.configureTestingModule({
    providers: [provideHttpClient(), provideHttpClientTesting()],
  });
});

afterEach(() => {
  try {
    TestBed.inject(HttpTestingController).verify();
  } finally {
    TestBed.resetTestingModule();
  }
});

test('directory upload strips the selected root folder and preserves relative file paths', async () => {
  const upload = TestBed.inject(DeploymentUpload);
  const http = TestBed.inject(HttpTestingController);
  const index = new File(['<html>'], 'index.html');
  const script = new File(['console.log(1)'], 'app.js');
  Object.defineProperty(index, 'webkitRelativePath', {
    value: 'dist/index.html',
  });
  Object.defineProperty(script, 'webkitRelativePath', {
    value: 'dist/assets/app.js',
  });
  const files = [index, script] as unknown as FileList;

  const result = upload.directory('project-id', files);
  const request = http.expectOne(
    `${environment.apiUrl}/api/deployments/artifacts`,
  );
  expect(request.request.method).toBe('POST');
  const body = request.request.body as FormData;
  expect(body.get('projectId')).toBe('project-id');
  expect(body.get('kind')).toBe('static');
  expect((body.getAll('files')[0] as File).name).toBe('index.html');
  expect((body.getAll('files')[1] as File).name).toBe('assets/app.js');
  request.flush({ artifactId: 'artifact-id', size: 12, sha256: 'digest' });
  await expect(result).resolves.toEqual({
    artifactId: 'artifact-id',
    size: 12,
    sha256: 'digest',
  });
});

test('directory upload rejects inconsistent roots and malformed upload responses', async () => {
  const upload = TestBed.inject(DeploymentUpload);
  const a = new File(['a'], 'a');
  const b = new File(['b'], 'b');
  Object.defineProperty(a, 'webkitRelativePath', { value: 'first/a' });
  Object.defineProperty(b, 'webkitRelativePath', { value: 'second/b' });
  await expect(
    upload.directory('project-id', [a, b] as unknown as FileList),
  ).rejects.toThrow('inconsistent file paths');

  const file = new File(['<html>'], 'site.zip', { type: 'application/zip' });
  const result = upload.archive('project-id', file);
  const request = TestBed.inject(HttpTestingController).expectOne(
    `${environment.apiUrl}/api/deployments/artifacts`,
  );
  request.flush({ artifactId: '', size: 'twelve', sha256: null });
  await expect(result).rejects.toThrow('upload response was invalid');
});

test('directory upload reports empty and missing paths before sending a request', async () => {
  const upload = TestBed.inject(DeploymentUpload);
  await expect(
    upload.directory('project-id', [] as unknown as FileList),
  ).rejects.toThrow('The selected directory is empty.');

  const file = new File(['a'], 'a');
  await expect(
    upload.directory('project-id', [file] as unknown as FileList),
  ).rejects.toThrow('Choose a directory so file paths are preserved.');
  TestBed.inject(HttpTestingController).expectNone(
    `${environment.apiUrl}/api/deployments/artifacts`,
  );
});
