import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class JwtOptionalGuard extends AuthGuard('jwt') {
  canActivate(context: ExecutionContext) {
    // Always return true to allow the request to proceed
    // The actual authentication logic is handled in handleRequest
    return super.canActivate(context);
  }

  handleRequest(err, user, info) {
    // If there's an error or no user, simply return null
    // This allows the request to proceed without authentication
    if (err || !user) {
      return null;
    }
    return user;
  }
}
