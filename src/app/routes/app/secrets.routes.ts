import { Routes } from '@angular/router';
// Secrets are practitioner work, not platform administration: the values a
// person stores for agents to act with. The shapes those values take are
// never written here: each is a resource an installed agent's manifest
// declares.
import { SecretsComponent } from '../../pages/app/secrets/secrets.component';
import { permissionGuard } from '../../guards/permission.guard';

export const SecretsRoutes: Routes = [
  // The page used to live at /secrets/values; links to it still work.
  { path: 'values', redirectTo: '', pathMatch: 'full' },
  {
    path: '',
    title: 'Secrets',
    component: SecretsComponent,
    canActivate: [permissionGuard],
    data: { requiredAction: 'secrets:secret:list' },
    // One secret, opened, is a view of the list's page.
    children: [
      { path: '', pathMatch: 'full', children: [] },
      { path: ':ref', children: [] },
    ],
  },
];
