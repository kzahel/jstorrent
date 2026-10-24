import descriptor from '../data/production-release.json';
import { selectProductionWebsiteRelease } from './production-release';

const selected = selectProductionWebsiteRelease(descriptor);
if (!selected) throw new Error('Production website requires a qualified release inventory');
export const productionSiteRelease = selected;
export const sourceRepositoryUrl = `https://github.com/${descriptor.release.repository}`;
