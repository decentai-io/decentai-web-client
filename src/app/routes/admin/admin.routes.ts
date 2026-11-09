// components
import { MembersComponent } from '../../pages/admin/members/members.component';
import { GroupsComponent } from '../../pages/admin/groups/groups.component';
import { PoliciesComponent } from '../../pages/admin/policies/policies.component';
import { ProfileComponent } from '../../pages/admin/profile/profile.component';
import { OrganizationsComponent } from '../../pages/admin/organizations/organizations.component';
import { Routes } from '@angular/router';
import { permissionGuard } from '../../guards/permission.guard';

// The admin console is identity & access.
export const AdminRoutes: Routes = [
  // identity & access (grouped as IAM in the sidebar; paths stay flat
  // because the sidebar matches a page against the second URL segment)
  {
    path: 'organization',
    title: 'Organization',
    component: OrganizationsComponent,
    canActivate: [permissionGuard],
    data: { requiredAction: 'iam:organization:get' },
  },
  {
    path: 'users',
    title: 'Users',
    component: MembersComponent,
    canActivate: [permissionGuard],
    data: { requiredAction: 'iam:user:list' },
  },
  {
    path: 'groups',
    title: 'Groups',
    component: GroupsComponent,
    canActivate: [permissionGuard],
    data: { requiredAction: 'iam:group:list' },
  },
  {
    path: 'profile',
    title: 'Profile',
    component: ProfileComponent,
    canActivate: [permissionGuard],
    data: { requiredAction: 'account:profile:get' },
  },
  {
    path: 'policies',
    title: 'Policies',
    component: PoliciesComponent,
    canActivate: [permissionGuard],
    data: { requiredAction: 'iam:policy:list' },
  },
  // Renamed from 'members'; kept so a remembered link still lands.
  { path: 'members', redirectTo: 'users' },
  // Groups give policies themselves now: there are no roles.
  { path: 'roles', redirectTo: 'groups' },

  // Secret types moved to the main workspace as Secret definitions.
  { path: 'secret_types', redirectTo: '/secrets', pathMatch: 'full' },
];
